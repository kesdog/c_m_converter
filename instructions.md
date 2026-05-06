Currency Converter Project Instructions

Project goal:
- Build a deployable currency converter with a Node.js backend and a lightweight frontend.
- Optimize API usage because of rate limits by caching daily currency rates.
- Keep the codebase modular so coding agents can extend it safely.

Current stack:
- Backend: Node.js HTTP server (`server.js`)
- Frontend: Vanilla HTML/CSS/ES modules (`index.html`, `app.js`)
- External API wrapper: `@everapi/freecurrencyapi-js`
- Tests: Node test runner (`node --test`)

Core features implemented:
- Convert one base currency into multiple target currencies.
- Daily cache policy:
  - If today’s rates exist in cache for requested targets, use cache.
  - If some targets are missing for today, fetch only missing targets and merge.
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
- `index.html`: page shell, language button/menu, form mount points.
- `app.js`: app bootstrap, i18n load, UI wiring, submit flow.
- `styles/styles.css`: responsive styles and component styling.
- `server.js`: static file serving, API endpoints, cache + provider logic.
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

Backend endpoints:
- `GET /api/currencies`
  - Returns `{ currencies, maxComparisons }`.
- `POST /convert` (and alias `/submit`)
  - Input: `{ amount, baseCurrency, targetCurrencies }`
  - Output includes conversion list + cache/source metadata.

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
  - Build image with Node LTS.
  - Inject API key and port via environment variables at runtime.
  - Mount `data/` as a persistent volume so cache survives restarts.
  - Place behind a reverse proxy (Nginx/Caddy) with HTTPS.

Agent guidance:
- Prefer adding new providers behind the same conversion contract returned by `/convert`.
- If adding provider failover, preserve cache semantics and include source metadata.
- Keep UI modules small; place reusable UI blocks/components in `ui/`.
- Keep user-facing text in `i18n/translations.json`; do not hardcode labels.
