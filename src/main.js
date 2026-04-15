import { Actor, log } from 'apify';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const LINKEDIN_ACTOR_ID = 'curious_coder~linkedin-jobs-scraper';

/**
 * Calls the curious_coder/linkedin-jobs-scraper Actor via Apify API
 * and waits for it to finish, then returns the dataset items.
 */
async function runLinkedInScraper(input) {
    log.info('Starting LinkedIn Jobs Scraper actor via API...', { input });

    const runUrl = `https://api.apify.com/v2/acts/${LINKEDIN_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&format=json`;

    const response = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LinkedIn scraper API call failed [${response.status}]: ${errorText}`);
    }

    const jobs = await response.json();
    log.info(`LinkedIn scraper returned ${jobs.length} jobs.`);
    return jobs;
}

// ─── Actor Entry Point ────────────────────────────────────────────────────────

await Actor.init();

try {
    // 1. Read this Actor's input
    const input = await Actor.getInput();
    log.info('Actor input received:', input);

    const {
        urls,
        scrapeCompany = true,
        count = 100,
        splitByLocation = false,
        splitCountry,
        // Optional filters applied in post-processing
        filterKeyword,
        filterLocation,
        filterDatePostedDays,
    } = input;

    if (!urls || urls.length === 0) {
        throw new Error('Input must include at least one LinkedIn Jobs search URL in "urls" field.');
    }

    if (!APIFY_TOKEN) {
        throw new Error('APIFY_TOKEN environment variable is not set. Add it in the Actor\'s Environment Variables in Apify Console.');
    }

    // 2. Build payload for the underlying scraper
    const scraperInput = {
        urls,
        scrapeCompany,
        count,
        splitByLocation,
        ...(splitCountry ? { splitCountry } : {}),
    };

    // 3. Run the underlying LinkedIn Jobs Scraper
    const jobs = await runLinkedInScraper(scraperInput);

    // 4. Optional client-side post-processing / filtering
    let results = jobs;

    if (filterKeyword) {
        const kw = filterKeyword.toLowerCase();
        results = results.filter(
            (j) =>
                (j.title && j.title.toLowerCase().includes(kw)) ||
                (j.description && j.description.toLowerCase().includes(kw)),
        );
        log.info(`After keyword filter ("${filterKeyword}"): ${results.length} jobs`);
    }

    if (filterLocation) {
        const loc = filterLocation.toLowerCase();
        results = results.filter(
            (j) => j.location && j.location.toLowerCase().includes(loc),
        );
        log.info(`After location filter ("${filterLocation}"): ${results.length} jobs`);
    }

    if (filterDatePostedDays) {
        const cutoff = Date.now() - filterDatePostedDays * 24 * 60 * 60 * 1000;
        results = results.filter((j) => {
            if (!j.postedAt) return true; // keep if no date info
            const posted = new Date(j.postedAt).getTime();
            return !isNaN(posted) && posted >= cutoff;
        });
        log.info(`After date filter (last ${filterDatePostedDays} days): ${results.length} jobs`);
    }

    // 5. Enrich each job with a scrape timestamp
    const enriched = results.map((job) => ({
        ...job,
        _scrapedAt: new Date().toISOString(),
    }));

    // 6. Push results to this Actor's dataset
    if (enriched.length > 0) {
        await Actor.pushData(enriched);
        log.info(`✅ Pushed ${enriched.length} jobs to dataset.`);
    } else {
        log.warning('No jobs matched the filters. Nothing pushed to dataset.');
    }

    // 7. Set a key-value store output summary
    await Actor.setValue('OUTPUT_SUMMARY', {
        totalJobsFromScraper: jobs.length,
        totalJobsAfterFilter: enriched.length,
        scrapedAt: new Date().toISOString(),
        inputUrls: urls,
    });

} catch (err) {
    log.error('Actor failed:', { message: err.message });
    throw err;
} finally {
    await Actor.exit();
}
