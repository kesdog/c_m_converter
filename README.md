# Currency And Metals Converter

A production-minded currency and metals conversion service with a responsive Chakra UI frontend and a small Node.js HTTP API. It is designed as a portfolio project that demonstrates practical full-stack decisions: agent-discoverable APIs, defensive validation, shared caching, abuse protection, and a container-ready deployment model without introducing an unnecessary database.

## Highlights

- Converts one currency into up to four distinct target currencies.
- Prices gold, silver, copper, and platinum in ounces or grams, including reverse calculations for a currency budget.
- Provides a responsive React and Chakra UI interface with light and dark themes, language selection, searchable currency targets, and native mobile-friendly selects.
- Exposes web routes and versioned JSON agent routes that share the same validation, cache, and source metadata.
- Publishes `/openapi.json` and `/llms.txt` so an AI agent can discover the integration without automating the UI.
- Uses JSON-file caches on a persistent volume instead of a database because this workload has no accounts, relational queries, or long-lived transactional data.
- Includes per-IP token-bucket rate limiting on every conversion endpoint.

## Architecture

```text
React + Chakra UI
        |
        v
Node HTTP application
  |       |       |
  |       |       +-- Agent discovery: OpenAPI and llms.txt
  |       +---------- Conversion validation and rate limiting
  +------------------ Three-hour JSON cache and external providers
```

The frontend is built with Vite and served as static assets by the same Node process that owns the API. The Docker image uses a build stage for the frontend, then runs a smaller production Node image.

## User Request Flow

1. The browser loads supported currencies, metals, and translations in parallel.
2. A user selects an amount and a base currency, then adds one or more target currencies. The UI excludes the base and already-selected targets before a user can choose them.
3. On submit, the client sends a JSON request to `/convert` or `/convert-metals`.
4. The server checks the per-IP rate-limit bucket, validates the request again, and rejects invalid or abusive requests before calling a provider.
5. The conversion service checks its one-hour cache. A fresh entry is returned immediately; otherwise the relevant provider data is fetched and written atomically to the persistent cache.
6. Currency or metal calculations are performed locally and returned with source, cache, freshness, and warning metadata for the UI to display. Provider failures never create synthetic rates or prices.

## Agent Request Flow

An agent follows the same protected conversion path as the web UI, but uses stable JSON endpoints:

1. Read `GET /openapi.json` or `GET /llms.txt` to discover the contract.
2. Optionally call `GET /api/agent/v1/currencies` or `GET /api/agent/v1/metals` to validate a desired code or symbol.
3. Submit a conversion request to the versioned agent endpoint.
4. Use the returned values and provenance metadata in the agent response. If `degraded` is true or `dataStatus` is `stale-cache`, treat the values as last-known estimates rather than current market data.

### Example Agent Call

```bash
curl -X POST https://currency.example.com/api/agent/v1/currency/convert \
  -H 'Content-Type: application/json' \
  -d '{
    "amount": 100,
    "baseCurrency": "USD",
    "targetCurrencies": ["EUR", "JPY"]
  }'
```

Example response shape:

```json
{
  "message": "Converted 100 USD into 2 currencies.",
  "cached": true,
  "stale": false,
  "degraded": false,
  "dataStatus": "fresh-cache",
  "warning": null,
  "source": "freecurrencyapi",
  "sourceSite": "freecurrencyapi.com",
  "fetchedAt": "2026-08-10T15:00:00.000Z",
  "cacheDate": "2026-08-10",
  "cacheExpiresAt": "2026-08-10T16:00:00.000Z",
  "cacheTtlSeconds": 3600,
  "cacheTtlRemainingSeconds": 2442,
  "cacheAgeSeconds": 1158,
  "staleBySeconds": 0,
  "conversions": [
    { "code": "EUR", "rate": 0.92, "convertedAmount": 92 },
    { "code": "JPY", "rate": 145.1, "convertedAmount": 14510 }
  ]
}
```

The values above are illustrative. Production responses use current provider data or shared cache data. `fetchedAt` records the exact UTC provider-fetch time, `cacheExpiresAt` gives the exact UTC expiry, `cacheTtlSeconds` is the configured one-hour lifetime, and the age fields are calculated when the response is created. If the provider fails after expiry and a valid stale cache exists, the response remains `200` but sets `stale: true`, `degraded: true`, `dataStatus: "stale-cache"`, and includes a warning with orange severity through 24 hours and red severity after 24 hours. If no usable cache exists, the response is `503` and contains no fabricated conversion values.

## Cache Strategy

The application keeps currency and metals data in separate JSON caches on the mounted `data/` volume:

- Currency rates are grouped by base currency. One provider refresh supplies the complete available rate set, so later target or amount changes reuse that same entry.
- Metal prices are grouped by metal symbol and fiat currency. Ounce, gram, and reverse calculations reuse the same cached source price and are calculated locally.
- Entries are fresh for less than one hour. Stale entries are retained as last-known-good fallback data and refreshed on demand.
- A provider failure returns the newest valid stale entry with an explicit warning; it never writes mock data.
- Cache writes are atomic, invalid or oversized entries are pruned, and each cache file is capped at 25 MB.

This approach reduces provider cost and latency while keeping deployment and failure modes straightforward for a small, stateless service.

## Abuse Protection: Token Bucket Rate Limiting

Every web and agent conversion route uses an independent token bucket for each client IP address:

- A client starts with 20 tokens, allowing a short burst of up to 20 conversion requests.
- Each accepted conversion consumes one token.
- One token is replenished every three seconds, up to the 20-token capacity.
- When no token is available, the API returns `429 Too Many Requests` and a `Retry-After` header with the remaining wait in seconds.
- Idle, fully replenished buckets are removed to keep the in-memory limiter bounded.

The design preserves normal interactive use and controlled agent workflows while preventing a single unauthenticated client from repeatedly exhausting provider calls or cache-write capacity.

## API Surface

| Route | Purpose |
| --- | --- |
| `GET /api/currencies` | Supported currencies and comparison limit for the web UI |
| `GET /api/metals` | Supported metal symbols |
| `POST /convert` | Currency conversion for the web UI |
| `POST /convert-metals` | Metal conversion for the web UI |
| `GET /openapi.json` | Machine-readable agent API description |
| `GET /llms.txt` | Agent-oriented usage guidance |
| `GET /api/agent/v1/currencies` | Versioned agent currency listing |
| `GET /api/agent/v1/metals` | Versioned agent metal listing |
| `POST /api/agent/v1/currency/convert` | Versioned agent currency conversion |
| `POST /api/agent/v1/metals/convert` | Versioned agent metal conversion |

## Local Development

```bash
npm install
npm run build
npm start
```

For frontend development with Vite:

```bash
npm run dev
```

Run the backend test suite with:

```bash
npm test
```

## Deployment

Deployment configuration, environment variables, Docker commands, persistent cache storage, and reverse-proxy guidance are documented in [instructions.md](./instructions.md).

---

# Convertisseur De Devises Et Metaux

Un service de conversion de devises et de metaux concu pour la production, avec une interface Chakra UI responsive et une petite API HTTP Node.js. Ce projet de portfolio met en avant des choix full-stack pragmatiques : API decouvrable par les agents, validation defensive, cache partage, protection contre les abus et deploiement en conteneur, sans ajouter une base de donnees inutile.

## Points Forts

- Convertit une devise vers jusqu'a quatre devises cibles distinctes.
- Calcule le prix de l'or, de l'argent, du cuivre et du platine en onces ou en grammes, y compris les calculs inverses a partir d'un budget en devise.
- Fournit une interface React et Chakra UI responsive avec themes clair et sombre, choix de langue, recherche de devises et listes natives adaptees au mobile.
- Expose des routes web et des routes JSON versionnees pour agents, avec la meme validation, le meme cache et les memes metadonnees de source.
- Publie `/openapi.json` et `/llms.txt` afin qu'un agent IA puisse decouvrir l'integration sans automatiser l'interface HTML.
- Utilise des fichiers JSON de cache sur un volume persistant plutot qu'une base de donnees, car cette charge ne comporte ni comptes utilisateurs, ni requetes relationnelles, ni transactions durables.
- Applique une limitation par seau a jetons et par adresse IP sur chaque endpoint de conversion.

## Architecture

```text
React + Chakra UI
        |
        v
Application HTTP Node
  |       |       |
  |       |       +-- Decouverte agent : OpenAPI et llms.txt
  |       +---------- Validation et limitation des conversions
        +------------------ Cache JSON d'une heure et fournisseurs externes
```

Le frontend est construit avec Vite puis servi sous forme d'actifs statiques par le meme processus Node qui fournit l'API. L'image Docker utilise une etape de build pour le frontend, suivie d'une image Node de production plus compacte.

## Parcours Utilisateur

1. Le navigateur charge en parallele les devises prises en charge, les metaux et les traductions.
2. L'utilisateur choisit un montant et une devise de base, puis ajoute une ou plusieurs devises cibles. L'interface exclut la devise de base et les devises deja selectionnees avant tout choix.
3. A la soumission, le client envoie une requete JSON vers `/convert` ou `/convert-metals`.
4. Le serveur verifie le seau de limitation de l'adresse IP, valide a nouveau la requete et rejette les requetes invalides ou abusives avant tout appel fournisseur.
5. Le service de conversion consulte son cache d'une heure. Une entree recente est renvoyee immediatement ; sinon, les donnees fournisseur sont recuperees et ecrites de maniere atomique dans le cache persistant.
6. Les calculs de devises ou de metaux sont realises localement et renvoyes avec les metadonnees de source, de cache et d'horodatage affichees par l'interface.

## Parcours Agent

Un agent suit le meme parcours de conversion protege que l'interface web, mais utilise des endpoints JSON stables :

1. Lire `GET /openapi.json` ou `GET /llms.txt` pour decouvrir le contrat.
2. Appeler facultativement `GET /api/agent/v1/currencies` ou `GET /api/agent/v1/metals` pour valider un code ou un symbole.
3. Envoyer la requete de conversion vers l'endpoint agent versionne.
4. Utiliser les valeurs retournees et les metadonnees de provenance dans la reponse de l'agent.

### Exemple D'Appel Agent

```bash
curl -X POST https://currency.example.com/api/agent/v1/currency/convert \
  -H 'Content-Type: application/json' \
  -d '{
    "amount": 100,
    "baseCurrency": "USD",
    "targetCurrencies": ["EUR", "JPY"]
  }'
```

Exemple de structure de reponse :

```json
{
  "message": "Converted 100 USD into 2 currencies.",
  "cached": true,
  "source": "cache",
  "sourceSite": "freecurrencyapi.com",
  "fetchedAt": "2026-08-10T15:00:00.000Z",
  "cacheDate": "2026-08-10",
  "cacheExpiresAt": "2026-08-10T18:00:00.000Z",
  "cacheTtlSeconds": 3600,
  "cacheTtlRemainingSeconds": 2442,
  "conversions": [
    { "code": "EUR", "rate": 0.92, "convertedAmount": 92 },
    { "code": "JPY", "rate": 145.1, "convertedAmount": 14510 }
  ]
}
```

Les valeurs ci-dessus sont indicatives. Les reponses de production utilisent les donnees actuelles du fournisseur ou du cache partage. `fetchedAt` enregistre l'heure UTC exacte de recuperation chez le fournisseur, `cacheExpiresAt` donne l'heure UTC exacte d'expiration, `cacheTtlSeconds` est la duree de vie configuree d'une heure et `cacheTtlRemainingSeconds` indique la duree de validite restante lors de la creation de la reponse.

## Strategie De Cache

L'application conserve les donnees de devises et de metaux dans des caches JSON distincts, sur le volume monte `data/` :

- Les taux de change sont regroupes par devise de base. Un rafraichissement fournisseur fournit l'ensemble des taux disponibles ; les changements ulterieurs de cible ou de montant reutilisent donc cette entree.
- Les prix des metaux sont regroupes par symbole de metal et devise fiat. Les calculs en once, en gramme et inverses reutilisent le meme prix source en cache et sont effectues localement.
- Les entrees restent recentes pendant moins d'une heure. Les entrees obsoletes sont rafraichies a la demande.
- Les ecritures sont atomiques, les entrees obsoletes sont supprimees et chaque fichier de cache est limite a 25 Mo.

Cette approche reduit les couts et la latence des fournisseurs tout en gardant le deploiement et les modes de panne simples pour un petit service sans etat.

## Protection Contre Les Abus : Seau A Jetons

Toutes les routes de conversion web et agent utilisent un seau a jetons independant pour chaque adresse IP cliente :

- Un client commence avec 20 jetons, ce qui autorise une courte rafale de 20 requetes de conversion.
- Chaque conversion acceptee consomme un jeton.
- Un jeton est reconstitue toutes les trois secondes, jusqu'a la capacite maximale de 20 jetons.
- Lorsqu'aucun jeton n'est disponible, l'API renvoie `429 Too Many Requests` avec un en-tete `Retry-After` indiquant le nombre de secondes restantes.
- Les seaux inactifs et entierement reconstitues sont supprimes pour que le limiteur en memoire reste borne.

Ce mecanisme preserve l'usage interactif normal et les workflows d'agents controles, tout en empechant un client non authentifie d'epuiser de facon repetee les appels fournisseur ou la capacite d'ecriture du cache.

## Surface API

| Route | Objectif |
| --- | --- |
| `GET /api/currencies` | Devises prises en charge et limite de comparaison pour l'interface web |
| `GET /api/metals` | Symboles de metaux pris en charge |
| `POST /convert` | Conversion de devises pour l'interface web |
| `POST /convert-metals` | Conversion de metaux pour l'interface web |
| `GET /openapi.json` | Description lisible par machine de l'API agent |
| `GET /llms.txt` | Guide d'utilisation destine aux agents |
| `GET /api/agent/v1/currencies` | Liste versionnee des devises pour agents |
| `GET /api/agent/v1/metals` | Liste versionnee des metaux pour agents |
| `POST /api/agent/v1/currency/convert` | Conversion de devises versionnee pour agents |
| `POST /api/agent/v1/metals/convert` | Conversion de metaux versionnee pour agents |

## Developpement Local

```bash
npm install
npm run build
npm start
```

Pour le developpement du frontend avec Vite :

```bash
npm run dev
```

Executer la suite de tests backend :

```bash
npm test
```

## Deploiement

La configuration de deploiement, les variables d'environnement, les commandes Docker, le stockage persistant du cache et les recommandations de reverse proxy sont documentes dans [instructions.md](./instructions.md).
