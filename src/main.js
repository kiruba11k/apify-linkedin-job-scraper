import { Actor } from 'apify';
import { PuppeteerCrawler, sleep } from 'crawlee';

// ──────────────────────────────────────────────────────────────────────────────
//  NATURAL-LANGUAGE FILTER DECODER
// ──────────────────────────────────────────────────────────────────────────────

const EXPERIENCE_MAP = {
    'internship':  '1', 'intern':      '1',
    'entry-level': '2', 'entry level': '2', 'junior': '2',
    'associate':   '3',
    'mid-senior':  '4', 'mid':         '4', 'senior': '4',
    'director':    '5',
    'executive':   '6',
};

const JOB_TYPE_MAP = {
    'full-time': 'F', 'full time': 'F', 'fulltime': 'F',
    'part-time': 'P', 'part time': 'P',
    'contract':  'C',
    'temporary': 'T',
    'internship':'I',
    'volunteer': 'V',
};

const TIME_POSTED_MAP = {
    '24 hours': 'r86400', '24h': 'r86400', 'past day': 'r86400', 'today': 'r86400',
    'week':     'r604800', '7 days': 'r604800',
    'month':    'r2592000','30 days': 'r2592000',
};

const WORK_TYPE_MAP = {
    'on-site': '1', 'onsite': '1', 'on site': '1',
    'remote':  '2',
    'hybrid':  '3',
};

const FILTER_NOISE = new Set([
    'entry','level','junior','senior','associate','mid','director','executive',
    'internship','intern','full','time','part','contract','temporary','volunteer',
    'posted','in','the','past','hours','days','weeks','months','remote','hybrid',
    'onsite','on','site','and','for','a','an','24','7','30','hour','day','week','month',
]);

function parseNaturalLanguageFilters(phrase) {
    const pl = phrase.toLowerCase();
    const params = {};

    for (const [token, code] of Object.entries(EXPERIENCE_MAP)) {
        if (pl.includes(token) && !params.f_E) params.f_E = code;
    }
    for (const [token, code] of Object.entries(JOB_TYPE_MAP)) {
        if (pl.includes(token) && !params.f_JT) params.f_JT = code;
    }
    for (const [token, code] of Object.entries(TIME_POSTED_MAP)) {
        if (pl.includes(token) && !params.f_TPR) params.f_TPR = code;
    }
    for (const [token, code] of Object.entries(WORK_TYPE_MAP)) {
        if (pl.includes(token) && !params.f_WT) params.f_WT = code;
    }

    const tokens = pl.split(/[\s\-]+/);
    const clean  = tokens
        .filter(t => t && !FILTER_NOISE.has(t) && !/^\d+$/.test(t) && t.length > 1)
        .join(' ')
        .trim();
    params.keywords = clean || phrase.trim();
    return params;
}

// ──────────────────────────────────────────────────────────────────────────────
//  BUILD SEARCH URL
// ──────────────────────────────────────────────────────────────────────────────

function buildSearchUrl(filters, location, geoId, start = 0) {
    const base = 'https://www.linkedin.com/jobs/search/';
    const p = new URLSearchParams({
        keywords: filters.keywords,
        location,
        start: String(start),
    });
    if (geoId)      p.set('geoId',  geoId);
    if (filters.f_E)   p.set('f_E',   filters.f_E);
    if (filters.f_JT)  p.set('f_JT',  filters.f_JT);
    if (filters.f_TPR) p.set('f_TPR', filters.f_TPR);
    if (filters.f_WT)  p.set('f_WT',  filters.f_WT);
    return `${base}?${p.toString()}`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  PAGE PARSERS  (run inside page.evaluate — no Node imports allowed)
// ──────────────────────────────────────────────────────────────────────────────

async function scrapeJobCards(page) {
    // Wait for at least one job card to appear
    await page.waitForSelector('ul.jobs-search__results-list li, div.jobs-search-results__list-item', {
        timeout: 20000,
    }).catch(() => {});

    // Scroll to bottom to trigger lazy-loaded cards
    await page.evaluate(async () => {
        await new Promise(resolve => {
            let totalHeight = 0;
            const distance = 500;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 300);
        });
    });

    await sleep(2000);

    return page.evaluate(() => {
        const cards = [];
        // Two possible list selectors depending on login state
        const items = document.querySelectorAll(
            'ul.jobs-search__results-list li, div.jobs-search-results__list-item'
        );

        items.forEach(li => {
            const card     = li.querySelector('[data-entity-urn]');
            const jobId    = card
                ? card.getAttribute('data-entity-urn').split(':').pop()
                : null;

            const linkEl   = li.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]');
            const jobUrl   = linkEl ? linkEl.href.split('?')[0] : null;

            const titleEl  = li.querySelector(
                'h3.base-search-card__title, h3[class*="title"], a[class*="job-card-list__title"]'
            );
            const compEl   = li.querySelector(
                'h4.base-search-card__subtitle, span[class*="company"], a[class*="company"]'
            );
            const locEl    = li.querySelector(
                'span.job-search-card__location, li[class*="location"], span[class*="location"]'
            );
            const dateEl   = li.querySelector('time') || null;
            const logoEl   = li.querySelector(
                'img.artdeco-entity-image, img[class*="logo"], img[class*="company-logo"]'
            );
            const compLink = li.querySelector(
                'a.hidden-nested-link, h4.base-search-card__subtitle a, a[href*="/company/"]'
            );

            if (!jobUrl && !jobId) return;

            cards.push({
                id:                 jobId,
                url:                jobUrl,
                title:              titleEl?.textContent?.trim() ?? null,
                companyName:        compEl?.textContent?.trim()  ?? null,
                companyLinkedinUrl: compLink?.href?.split('?')[0] ?? null,
                companyLogo:        logoEl
                    ? (logoEl.getAttribute('data-delayed-url') || logoEl.src)
                    : null,
                location:           locEl?.textContent?.trim()   ?? null,
                postedAt:           dateEl?.getAttribute('datetime') ?? null,
            });
        });

        return cards;
    });
}

async function scrapeJobDetail(page) {
    // Wait for description block
    await page.waitForSelector(
        '.show-more-less-html__markup, .description__text, section.description',
        { timeout: 15000 }
    ).catch(() => {});

    return page.evaluate(() => {
        // ── JSON-LD ──
        let ld = {};
        try {
            const ldTag = document.querySelector('script[type="application/ld+json"]');
            if (ldTag) ld = JSON.parse(ldTag.textContent);
        } catch (_) {}

        // ── Description ──
        const descTag = (
            document.querySelector('.show-more-less-html__markup') ||
            document.querySelector('.description__text--rich')     ||
            document.querySelector('.description__text')           ||
            document.querySelector('div.jobs-description__content')
        );
        const descriptionText = descTag
            ? descTag.innerText.trim()
            : null;

        // ── Criteria list (seniority / employment type / function / industries) ──
        let seniorityLevel = null, employmentType = null, jobFunction = null, industries = null;

        document.querySelectorAll('ul.description__job-criteria-list li').forEach(item => {
            const hdr = item.querySelector('h3.description__job-criteria-subheader');
            const val = item.querySelector('span.description__job-criteria-text');
            if (!hdr || !val) return;
            const key = hdr.textContent.trim().toLowerCase();
            const v   = val.textContent.trim();
            if (key.includes('seniority'))  seniorityLevel = v;
            else if (key.includes('employment')) employmentType = v;
            else if (key.includes('job function')) jobFunction = v;
            else if (key.includes('industr')) industries = v;
        });

        // Newer insight-chip layout fallback
        if (!seniorityLevel) {
            const labels = new Set([
                'Internship','Entry level','Associate',
                'Mid-Senior level','Director','Executive','Not Applicable',
            ]);
            document.querySelectorAll(
                'li.job-details-jobs-unified-top-card__job-insight span, '
                + 'span.job-details-jobs-unified-top-card__job-insight-view-model-secondary'
            ).forEach(el => {
                if (!seniorityLevel && labels.has(el.textContent.trim()))
                    seniorityLevel = el.textContent.trim();
            });
        }

        // ── Applicant count ──
        let applicantsCount = null;
        const appEl = (
            document.querySelector('.num-applicants__caption') ||
            document.querySelector('span[class*="applicant"]') ||
            document.querySelector('div[class*="applicant"]')  ||
            document.querySelector('span[class*="tvm__text"]')
        );
        if (appEl) {
            const t = appEl.textContent.trim();
            if (/applicant|clicked/i.test(t)) applicantsCount = t;
        }
        if (!applicantsCount) {
            const m = document.body.innerText.match(
                /([\d,]+\+?\s*(?:over\s*)?(?:applicants?|people clicked apply))/i
            );
            if (m) applicantsCount = m[1].trim();
        }

        // ── Apply URL ──
        let applyUrl = ld.url || ld.sameAs || null;
        if (!applyUrl) {
            const applyEl = (
                document.querySelector('a.apply-button--link')                     ||
                document.querySelector('a[data-tracking-control-name*="apply"]')   ||
                document.querySelector('a.jobs-apply-button')                      ||
                document.querySelector('a[href*="/jobs/apply/"]')
            );
            if (applyEl) applyUrl = applyEl.href;
        }
        applyUrl = applyUrl || window.location.href;

        // ── Company website ──
        let companyWebsite = (ld.hiringOrganization?.sameAs || ld.hiringOrganization?.url) ?? null;
        if (!companyWebsite) {
            const el = document.querySelector(
                'a[data-tracking-control-name*="company-website"]'
            );
            if (el) companyWebsite = el.href;
        }

        // ── Job poster / hiring manager ──
        let jobPosterName = null, jobPosterTitle = null,
            jobPosterPhoto = null, jobPosterProfileUrl = null;

        const poster = (
            document.querySelector('div.message-the-recruiter') ||
            document.querySelector('div.hirer-card')            ||
            document.querySelector('section.message-the-recruiter')
        );
        if (poster) {
            const nameEl  = poster.querySelector('span.hirer-card__hirer-name, a strong, strong');
            const titleEl2= poster.querySelector(
                'span.hirer-card__hirer-title, p.hirer-card__hirer-title, p'
            );
            const photoEl = poster.querySelector('img');
            const linkEl  = poster.querySelector('a[href*="/in/"], a');
            jobPosterName       = nameEl?.textContent?.trim()   ?? null;
            jobPosterTitle      = titleEl2?.textContent?.trim() ?? null;
            jobPosterPhoto      = photoEl
                ? (photoEl.getAttribute('data-delayed-url') || photoEl.src)
                : null;
            jobPosterProfileUrl = linkEl ? linkEl.href.split('?')[0] : null;
        }

        return {
            descriptionText,
            applicantsCount,
            applyUrl,
            jobPosterName,
            jobPosterTitle,
            jobPosterPhoto,
            jobPosterProfileUrl,
            seniorityLevel,
            employmentType: employmentType || ld.employmentType || null,
            jobFunction:    jobFunction    || ld.occupationalCategory || null,
            industries,
            companyWebsite,
        };
    });
}

// ──────────────────────────────────────────────────────────────────────────────
//  MAIN ACTOR
// ──────────────────────────────────────────────────────────────────────────────

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    naturalQuery  = 'software engineer',
    location      = 'Bangalore, India',
    geoId         = '105214831',
    pages         = 2,
    delayBetweenJobs  = 4000,
    delayBetweenPages = 5000,
} = input;

const filters = parseNaturalLanguageFilters(naturalQuery);

console.log('══════════════════════════════════════════════════════');
console.log('  LinkedIn Job Scraper — Apify Actor');
console.log('══════════════════════════════════════════════════════');
console.log(`  Query    : ${naturalQuery}`);
console.log(`  Keywords : ${filters.keywords}`);
console.log(`  f_E=${filters.f_E||'any'} f_JT=${filters.f_JT||'any'} f_TPR=${filters.f_TPR||'any'} f_WT=${filters.f_WT||'any'}`);
console.log(`  Location : ${location}  geoId=${geoId}`);
console.log(`  Pages    : ${pages}`);
console.log('══════════════════════════════════════════════════════');

const allJobs = [];

const crawler = new PuppeteerCrawler({
    // Apify proxy keeps LinkedIn from blocking
    proxyConfiguration: await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
    }).catch(() => null),

    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        },
    },

    // Stealth — removes webdriver flag
    useSessionPool: true,
    persistCookiesPerSession: true,

    // We drive navigation manually; disable auto-retry loops
    maxRequestRetries: 3,
    navigationTimeoutSecs: 45,

    requestHandlerTimeoutSecs: 120,

    async requestHandler({ page, request, log }) {
        const { userData } = request;

        // ── Handle: SEARCH LISTING page ──────────────────────────────────────
        if (userData.type === 'LISTING') {
            const { pageIndex } = userData;
            log.info(`Listing page ${pageIndex + 1}/${pages} ...`);

            // Remove automation signals
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            const url = buildSearchUrl(filters, location, geoId, pageIndex * 25);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

            const cards = await scrapeJobCards(page);
            log.info(`  Found ${cards.length} job cards`);

            if (cards.length === 0) {
                log.warning('  No cards — stopping pagination.');
                return;
            }

            for (const job of cards) {
                if (job.url) {
                    await crawler.addRequests([{
                        url:      job.url,
                        userData: { type: 'JOB_DETAIL', card: job },
                    }]);
                } else {
                    allJobs.push(job);
                    await Actor.pushData(job);
                }
            }
        }

        // ── Handle: JOB DETAIL page ───────────────────────────────────────────
        else if (userData.type === 'JOB_DETAIL') {
            const { card } = userData;
            log.info(`  Detail: ${card.title ?? '?'} @ ${card.companyName ?? '?'}`);

            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            await page.goto(request.url, { waitUntil: 'networkidle2', timeout: 40000 });

            const detail = await scrapeJobDetail(page);

            const job = { ...card, ...detail };
            allJobs.push(job);
            await Actor.pushData(job);

            await sleep(delayBetweenJobs + Math.floor(Math.random() * 3000));
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Request failed: ${request.url}`);
    },
});

// Seed listing pages
const listingRequests = [];
for (let i = 0; i < pages; i++) {
    listingRequests.push({
        url:      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(filters.keywords)}&start=${i * 25}`,
        userData: { type: 'LISTING', pageIndex: i },
        // Give each listing page a unique label so Crawlee doesn't dedup them
        uniqueKey: `listing-page-${i}`,
    });
}

await crawler.run(listingRequests);

console.log(`\nDone. Total jobs scraped: ${allJobs.length}`);
await Actor.exit();
