# LinkedIn Job Scraper — Apify Actor

Scrapes LinkedIn job listings using a **headless Puppeteer browser** so pages fully render before extraction. Supports natural-language filter phrases.

> ⚠️ **Educational purposes only.** Scraping LinkedIn may violate their Terms of Service. Use responsibly.

---

## Features

- Natural-language query parsing (`entry-level`, `full-time`, `remote`, `past 24 hours`, etc.)
- Full browser rendering — no more empty card fields from lazy-loaded content
- Scroll-to-bottom on listing pages to trigger all lazy-loaded job cards
- Extracts: title, company, location, posted date, seniority, employment type, job function, industries, applicant count, apply URL, job poster info, description
- Saves to Apify Dataset (viewable as a table in the console)

---

## Input

| Field              | Default               | Description |
|--------------------|-----------------------|-------------|
| `naturalQuery`     | `"software engineer"` | Free-text query including filter words |
| `location`         | `"Bangalore, India"`  | City / country |
| `geoId`            | `"105214831"`         | LinkedIn numeric geoId (more precise) |
| `pages`            | `2`                   | Pages of results (25 jobs each) |
| `delayBetweenJobs` | `4000`                | ms delay between job detail fetches |
| `delayBetweenPages`| `5000`                | ms delay between listing pages |

### Natural-language filter words

| Category    | Words you can use |
|-------------|-------------------|
| Experience  | `entry-level`, `junior`, `associate`, `mid`, `senior`, `director`, `executive` |
| Job type    | `full-time`, `part-time`, `contract`, `temporary` |
| Time posted | `past 24 hours`, `today`, `past week`, `past month` |
| Work type   | `remote`, `hybrid`, `on-site` |

**Example queries:**
```
entry-level aiml engineer full-time posted in the past 24 hours
senior backend engineer remote
data scientist contract past week
```

---

## Output fields

| Field                | Description |
|----------------------|-------------|
| `id`                 | LinkedIn job ID |
| `url`                | LinkedIn job URL |
| `title`              | Job title |
| `companyName`        | Company name |
| `companyLinkedinUrl` | Company LinkedIn page |
| `companyLogo`        | Company logo image URL |
| `companyWebsite`     | Company external website |
| `location`           | Job location |
| `postedAt`           | ISO date string |
| `descriptionText`    | Full job description (plain text) |
| `applicantsCount`    | e.g. "47 applicants" |
| `applyUrl`           | Direct apply link |
| `jobPosterName`      | Hiring manager name |
| `jobPosterTitle`     | Hiring manager title |
| `jobPosterPhoto`     | Hiring manager photo URL |
| `jobPosterProfileUrl`| Hiring manager LinkedIn URL |
| `seniorityLevel`     | e.g. "Entry level", "Mid-Senior level" |
| `employmentType`     | e.g. "Full-time" |
| `jobFunction`        | e.g. "Engineering" |
| `industries`         | e.g. "Software Development" |

---

## Common GeoIds

| City       | GeoId |
|------------|-------|
| Bangalore  | 105214831 |
| Hyderabad  | 105556635 |
| Mumbai     | 102713980 |
| Delhi NCR  | 102257491 |
| Chennai    | 102150915 |
| Remote     | 92000000  |

---

 Use **RESIDENTIAL** proxy group for best results (avoids LinkedIn blocks).
