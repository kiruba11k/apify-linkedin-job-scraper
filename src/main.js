import { Actor } from 'apify';
import { PuppeteerCrawler, sleep } from 'crawlee';

// ──────────────────────────────────────────────────────────────────────────────
//  NATURAL-LANGUAGE FILTER DECODER
// ──────────────────────────────────────────────────────────────────────────────

const EXPERIENCE_MAP = {
    'internship': '1', 'intern': '1',
    'entry-level': '2', 'entry level': '2', 'junior': '2',
    'associate': '3',
    'mid-senior': '4', 'mid': '4', 'senior': '4',
    'director': '5',
    'executive': '6',
};

const JOB_TYPE_MAP = {
    'full-time': 'F', 'full time': 'F', 'fulltime': 'F',
    'part-time': 'P', 'part time': 'P',
    'contract': 'C',
    'temporary': 'T',
    'internship': 'I',
    'volunteer': 'V',
};

const TIME_POSTED_MAP = {
    '24 hours': 'r86400', '24h': 'r86400', 'past day': 'r86400', 'today': 'r86400',
    'week': 'r604800', '7 days': 'r604800',
    'month': 'r2592000', '30 days': 'r2592000',
};

const WORK_TYPE_MAP = {
    'on-site': '1', 'onsite': '1', 'on site': '1',
    'remote': '2',
    'hybrid': '3',
};

const FILTER_NOISE = new Set([
    'entry', 'level', 'junior', 'senior', 'associate', 'mid', 'director', 'executive',
    'internship', 'intern', 'full', 'time', 'part', 'contract', 'temporary', 'volunteer',
    'posted', 'in', 'the', 'past', 'hours', 'days', 'weeks', 'months', 'remote', 'hybrid',
    'onsite', 'on', 'site', 'and', 'for', 'a', 'an', '24', '7', '30', 'hour', 'day', 'week', 'month',
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
    const clean = tokens
        .filter(t => t && !FILTER_NOISE.has(t) && !/^\d+$/.test(t) && t.length > 1)
        .join(' ')
        .trim();
    params.keywords = clean || phrase.trim();
    return params;
}

function buildSearchUrl(filters, location, geoId, start = 0) {
    const base = 'https://www.linkedin.com/jobs/search/';
    const p = new URLSearchParams({
        keywords: filters.keywords,
        location,
        start: String(start),
    });
    if (geoId) p.set('geoId', geoId);
    if (filters.f_E) p.set('f_E', filters.f_E);
    if (filters.f_JT) p.set('f_JT', filters.f_JT);
    if (filters.f_TPR) p.set('f_TPR', filters.f_TPR);
    if (filters.f_WT) p.set('f_WT', filters.f_WT);
    return `${base}?${p.toString()}`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  PAGE PARSERS
// ──────────────────────────────────────────────────────────────────────────────

async function scrapeJobCards(page) {
    await page.waitForSelector('ul.jobs-search__results-list li, div.jobs-search-results__list-item', {
        timeout: 15000,
    }).catch(() => {});

    await page.evaluate(async () => {
        await new Promise(resolve => {
            let totalHeight = 0;
            const distance = 1000;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 150);
        });
    });

    return page.evaluate(() => {
        const cards = [];
        const items = document.querySelectorAll('ul.jobs-search__results-list li, div.jobs-search-results__list-item');

        items.forEach(li => {
            const card = li.querySelector('[data-entity-urn]');
            const jobId = card ? card.getAttribute('data-entity-urn').split(':').pop() : null;
            const linkEl = li.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]');
            const jobUrl = linkEl ? linkEl.href.split('?')[0] : null;
            const titleEl = li.querySelector('h3.base-search-card__title, h3[class*="title"]');
            const compEl = li.querySelector('h4.base-search-card__subtitle, span[class*="company"]');
            const locEl = li.querySelector('span.job-search-card__location, span[class*="location"]');

            if (!jobUrl && !jobId) return;

            cards.push({
                id: jobId,
                url: jobUrl,
                title: titleEl?.textContent?.trim() ?? null,
                companyName: compEl?.textContent?.trim() ?? null,
                location: locEl?.textContent?.trim() ?? null,
            });
        });
        return cards;
    });
}

async function scrapeJobDetail(page) {
    await page.waitForSelector('.show-more-less-html__markup, .description__text', { timeout: 10000 }).catch(() => {});
    return page.evaluate(() => {
        const descTag = document.querySelector('.show-more-less-html__markup, .description__text');
        const applyEl = document.querySelector('a.apply-button--link, a.jobs-apply-button');

        return {
            descriptionText: descTag ? descTag.innerText.trim() : null,
            applyUrl: applyEl ? applyEl.href : window.location.href,
            seniorityLevel: document.querySelector('.description__job-criteria-text')?.textContent?.trim() ?? null,
        };
    });
}

// ──────────────────────────────────────────────────────────────────────────────
//  MAIN ACTOR
// ──────────────────────────────────────────────────────────────────────────────

await Actor.init();
const input = await Actor.getInput() ?? {};

const {
    naturalQuery = 'software engineer',
    location = 'Bangalore, India',
    geoId = '105214831',
    pages = 2,
} = input;

const filters = parseNaturalLanguageFilters(naturalQuery);

const crawler = new PuppeteerCrawler({
    // SPEED: Increased concurrency for faster scraping
    minConcurrency: 5,
    maxConcurrency: 10,
    
    // PROXY: Essential for avoiding LinkedIn's anti-bot systems
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

    // PERFORMANCE: Block images and styles to save $ and speed up page load
    preNavigationHooks: [
        async ({ page }) => {
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        },
    ],

    async requestHandler({ page, request, log }) {
        const { userData } = request;

        // Mask automation
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        if (userData.type === 'LISTING') {
            log.info(`Scraping search page ${userData.pageIndex + 1}...`);
            const url = buildSearchUrl(filters, location, geoId, userData.pageIndex * 25);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            const cards = await scrapeJobCards(page);
            log.info(`Found ${cards.length} jobs. Queuing detail pages...`);

            for (const job of cards) {
                if (job.url) {
                    await crawler.addRequests([{
                        url: job.url,
                        userData: { type: 'JOB_DETAIL', card: job },
                        // Avoid duplicates
                        uniqueKey: job.id || job.url,
                    }]);
                }
            }
        } else if (userData.type === 'JOB_DETAIL') {
            log.info(`Processing Job: ${userData.card.title} at ${userData.card.companyName}`);
            await page.goto(request.url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            const detail = await scrapeJobDetail(page);
            
            // Push combined data immediately
            await Actor.pushData({
                ...userData.card,
                ...detail,
                scrapedAt: new Date().toISOString(),
            });
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Request failed: ${request.url}`);
    },
});

// Seed the queue with listing pages
const listingRequests = [];
for (let i = 0; i < pages; i++) {
    listingRequests.push({
        url: 'https://www.linkedin.com/jobs/search/', 
        userData: { type: 'LISTING', pageIndex: i },
        uniqueKey: `list-page-${i}`,
    });
}

await crawler.run(listingRequests);

log.info('Scrape finished successfully.');
await Actor.exit();
