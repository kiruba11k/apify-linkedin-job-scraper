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
    } = input;

    if (!urls || urls.length === 0) {
        throw new Error('Input must include at least one LinkedIn Jobs search URL in "urls" field.');
    }

    if (!APIFY_TOKEN) {
        throw new Error('APIFY_TOKEN environment variable is not set.');
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

    // 4. Enrich each job with a scrape timestamp
    const enriched = jobs.map((job) => ({
        ...job,
        _scrapedAt: new Date().toISOString(),
    }));

    // 5. Push results to this Actor's dataset
    if (enriched.length > 0) {
        await Actor.pushData(enriched);
        log.info(`✅ Pushed ${enriched.length} jobs to dataset.`);
    } else {
        log.warning('No jobs returned from scraper. Nothing pushed to dataset.');
    }

    // 6. Set a key-value store output summary
    await Actor.setValue('OUTPUT_SUMMARY', {
        totalJobsFromScraper: jobs.length,
        totalJobsAfterProcessing: enriched.length,
        scrapedAt: new Date().toISOString(),
        inputUrls: urls,
    });

} catch (err) {
    log.error('Actor failed:', { message: err.message });
    throw err;
} finally {
    await Actor.exit();
}
