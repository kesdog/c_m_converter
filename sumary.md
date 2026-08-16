# Currency And Metals Converter

This project is a lightweight Node.js web application that converts currencies and precious metals without relying on a database or a large backend framework. It was built to be simple to deploy, easy to understand, and efficient with third-party API usage.

## What The Project Does

- Converts one currency into multiple target currencies.
- Converts metals like gold, silver, copper, and platinum into fiat currencies.
- Supports reverse metal calculations so a user can see how much metal they can buy for a given amount of currency.
- Supports ounce and gram views, with gram calculations derived locally from ounce pricing.

## Why The Data Is Handled This Way

The application intentionally avoids a database. For a portfolio project, a database would add operational overhead without adding much value to the user experience. Instead, the app uses shared JSON cache files stored on a mounted volume.

This approach keeps the system small and deployable while still solving the real problem: avoiding redundant external API calls.

## Cache Strategy

The app uses two separate cache files:

- `data/rates-cache.json` for currency exchange rates
- `data/metals-cache.json` for metal pricing

The caches are separated because the two datasets have different shapes and usage patterns:

- Currency data is grouped by base currency with the complete rate set returned by one provider call.
- Metal data is grouped by metal symbol and target currency, then reused for ounce, gram, and reverse calculations.

## Why Cache Instead Of Calling APIs Every Time

- Reduces redundant API calls.
- Improves response time for repeat requests.
- Makes the app more resilient when external APIs are slow or unavailable.
- Keeps infrastructure simple and low cost.

## Agent API

The application exposes `/openapi.json` and `/llms.txt` so agents can discover the JSON API without driving the HTML interface. Agent conversion endpoints share the same cache and validation as user-facing conversion endpoints. All conversion routes use a per-IP token bucket with a 20-request capacity and one token replenished every three seconds.

Once a metal ounce price is cached, gram prices and reverse conversions are calculated locally. That means the app reuses the same cached source price instead of making new requests for every variation.

## Cache Freshness Rules

- Cached entries are valid for less than one hour from the stored timestamp.
- If a cached entry is older than one hour, it is treated as stale and refreshed when possible.
- If the provider is unavailable, the most recent valid stale entry is returned with a warning; no mock values are generated.
- Stale fallback warnings are orange through 24 hours and red after 24 hours.
- If no valid cache exists during a provider outage, the conversion request fails with HTTP 503.
- This is more precise than a calendar-day cache because it avoids data going stale immediately after midnight.

## Storage And Size Limits

The caches are designed for a shared volume so multiple app instances can read the same cached data.

To keep the footprint small:

- Cache files are pruned automatically.
- Invalid entries are removed; stale entries are retained for outage fallback.
- Each cache file is capped at 25 MB, keeping the total cache footprint under 50 MB.

## Why No Database

The project does not need relational queries, user accounts, or long-term transactional storage. Using a database would increase complexity, deployment effort, and maintenance for very little gain.

For this use case, shared cache files provide the best balance of:

- simplicity
- low storage use
- easy deployment
- fast reads
- low infrastructure overhead

## Deployment Model

The app is intended to run in a container with:

- environment variables loaded from a `.env` file
- a mounted shared `data/` volume for cache persistence
- no external database dependency

That makes it a good fit for a portfolio deployment where operational simplicity matters as much as functionality.
