Currency Converter Project Instructions

Project goal:
- Build a deployable currency converter with a Node.js backend and a lightweight frontend.
- Optimize API usage by caching exchange and metal rates for three hours.
- Keep the codebase modular so coding agents can extend it safely.

Current stack:
- Backend: Node.js HTTP server (`server.js`, `httpApp.js`)
- Frontend: React, Chakra UI, and Vite (`src/`)
- External API wrapper: `@everapi/freecurrencyapi-js`
- Tests: Node test runner (`node --test`)

Core features implemented:
- Convert one base currency into multiple target currencies.
- Three-hour cache policy:
  - If a fresh rate set exists for the selected base currency, use cache.
  - If it is stale, fetch all available rates for that base currency in one request.
  - Reuse cached rates for recalculations with new amounts.
- API source metadata in UI:
  - Fresh: shows source site + timestamp.
  - Cached: shows cached timestamp + cache date.
- Target currency block system:
  - Add blocks with `+` button.
  - Remove added blocks with `X`.
  - Prevent duplicates and base=target in UI.
- Backend validation mirrors frontend validation for safety.
- Internationalization (i18n):
  - Default English (UK flag).
  - French, German, Spanish options.
  - Flag button opens language menu; selection persists and reloads.

Important architecture decisions:
- `currencies.json` is the source of available currencies.
- `data/` is runtime cache storage for API results.
- `data_test_cache/` is separate cache storage for tests.
- Translation content is stored in `i18n/translations.json`.
- Reusable target-currency block UI is in `ui/targetBlock.js`.
- Validation logic is extracted:
  - Client validation: `validation/clientValidation.js`
  - Server validation: `validation/serverValidation.js`

Current file layout:
- `index.html`, `currency.html`, `metals.html`: Vite page entries and React mount points.
- `src/App.jsx`: UI, i18n wiring, form state, and submit flow.
- `src/themes/`: separate light and dark semantic colour tokens.
- `src/styles.css`: shared responsive and component styling.
- `server.js`: server bootstrap and production static-asset selection.
- `httpApp.js`: static file serving, API routes, validation, and rate-limit integration.
- `conversionService.js`: provider calls, cache lifecycle, and conversion calculations.
- `currencies.json`: supported currency list.
- `i18n/translations.json`: translated labels/messages.
- `ui/targetBlock.js`: reusable target conversion block component.
- `validation/clientValidation.js`: frontend validation rules.
- `validation/serverValidation.js`: backend validation rules.
- `tests/server.test.js`: integration-style backend tests.
- `.env`: local secrets/config (never commit).
- `.gitignore`: ignores secrets, dependencies, runtime/test cache JSON files.

Environment variables:
- `EXCHANGE_RATE_API_KEY` or `FREECURRENCY_API_KEY`
  - If a full URL is provided, server extracts `apikey` automatically.
- `APP_PORT` (default `3000`)
- `CACHE_DIR` (optional; defaults to `data`)
- `TRUST_PROXY` (set to `true` behind the supplied Nginx proxy so rate limits use `X-Real-IP`)

Backend endpoints:
- `GET /api/currencies`
  - Returns `{ currencies, maxComparisons }`.
- `POST /convert` (and alias `/submit`)
  - Input: `{ amount, baseCurrency, targetCurrencies }`
  - Output includes conversion list + cache/source metadata.
- `GET /openapi.json`
  - Machine-readable specification for the agent API.
- `GET /llms.txt`
  - Agent integration guidance.
- `/api/agent/v1/*`
  - Agent aliases for currencies, metals, and both conversion routes; they share the web routes' cache and validation.

Validation rules (must keep):
- Amount must be a positive number.
- Base currency is required.
- At least one target currency is required.
- No duplicate target currencies.
- Base currency cannot appear in targets.
- Respect max comparisons limit.

Testing:
- Run all tests: `npm test`
- Tests use isolated cache directory (`data_test_cache`) via `CACHE_DIR`.
- Keep tests deterministic (no dependency on existing runtime cache files).

Deployment notes:
- App is ready for containerized deployment.
- Recommended production pattern:
  - Build the multi-stage image with `docker compose up --build -d`.
  - Inject API key and port via environment variables at runtime.
  - Mount `data/` as a persistent volume so cache survives restarts.
  - Place behind a reverse proxy (Nginx/Caddy) with HTTPS.
  - Route a dedicated subdomain such as `currency.yoursite.com` to the container because the application uses root-relative routes.
- Environment variables:
  - `FREECURRENCY_API_KEY`: provider API key.
  - `APP_PORT`: internal Node server port, default `3000`.
  - `HOST_PORT`: host port used by Docker Compose, default `3000`.
  - `CACHE_DIR`: runtime cache directory, default `data`.
  - `TRUST_PROXY`: set to `true` behind the supplied Nginx pattern so rate limits use `X-Real-IP`.
- Docker commands:
  - Start or rebuild: `docker compose up --build -d`.
  - Stop: `docker compose down`.
- The example Nginx configuration is in `deploy/nginx/currency-converter.conf`.

Agent guidance:
- Prefer adding new providers behind the same conversion contract returned by `/convert`.
- If adding provider failover, preserve cache semantics and include source metadata.
- Keep UI modules small; place reusable UI blocks/components in `ui/`.
- Keep user-facing text in `i18n/translations.json`; do not hardcode labels.
