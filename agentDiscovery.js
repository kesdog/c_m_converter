const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "Currency and Metals Converter Agent API",
    version: "1.0.0",
    description:
      "Use these JSON endpoints instead of the HTML interface. Conversion data is shared with the web UI cache and refreshed when older than one hour. Provider failures never generate synthetic values: a valid stale cache may be returned with degraded=true, otherwise the endpoint returns 503."
  },
  paths: {
    "/api/agent/v1/currencies": {
      get: { summary: "List supported currencies", responses: { 200: { description: "Currency list" } } }
    },
    "/api/agent/v1/metals": {
      get: { summary: "List supported metals", responses: { 200: { description: "Metal list" } } }
    },
    "/api/agent/v1/currency/convert": {
      post: {
        summary: "Convert one currency to up to four target currencies",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount", "baseCurrency", "targetCurrencies"],
                properties: {
                  amount: { type: "number", exclusiveMinimum: 0 },
                  baseCurrency: { type: "string", example: "USD" },
                  targetCurrencies: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "Live, fresh-cache, or explicitly degraded stale-cache conversion result" },
          400: { description: "Invalid request" },
          429: { description: "Rate limited" },
          503: { description: "Provider unavailable and no usable cache exists" }
        }
      }
    },
    "/api/agent/v1/metals/convert": {
      post: {
        summary: "Convert metal and currency amounts",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount", "metalSymbol", "currency"],
                properties: {
                  amount: { type: "number", exclusiveMinimum: 0 },
                  metalSymbol: { type: "string", example: "XAU" },
                  currency: { type: "string", example: "USD" },
                  unit: { type: "string", enum: ["oz", "g"], default: "oz" },
                  operation: { type: "string", enum: ["metal-to-currency", "currency-to-metal"], default: "metal-to-currency" }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "Live, fresh-cache, or explicitly degraded stale-cache conversion result" },
          400: { description: "Invalid request" },
          429: { description: "Rate limited" },
          503: { description: "Provider unavailable and no usable cache exists" }
        }
      }
    }
  }
};

const LLMS_DOCUMENT = `# Currency and Metals Converter Agent API

Use the JSON agent API instead of the HTML interface.

- OpenAPI: /openapi.json
- Supported currencies: GET /api/agent/v1/currencies
- Supported metals: GET /api/agent/v1/metals
- Currency conversion: POST /api/agent/v1/currency/convert
- Metals conversion: POST /api/agent/v1/metals/convert

Currency requests require amount, baseCurrency, and targetCurrencies (one to four unique codes). Metal requests require amount, metalSymbol, and currency; unit defaults to oz and operation defaults to metal-to-currency.

Agent and web routes share the same one-hour cache. Currency rates refresh as a complete base-currency set; metal prices refresh per metal/currency pair. Responses include cached, stale, degraded, dataStatus, warning, source, sourceSite, fetchedAt, cacheDate, cacheExpiresAt, cacheTtlSeconds, cacheTtlRemainingSeconds, cacheAgeSeconds, and staleBySeconds. dataStatus is live, fresh-cache, or stale-cache. A stale-cache response is usable last-known data, not current market data, and must be presented as an estimate with its warning. The warning includes severity=orange for stale data through 24 hours and severity=red after 24 hours. Provider failures never create mock values. If no valid cache exists, conversion endpoints return HTTP 503 with error.code=UPSTREAM_UNAVAILABLE_NO_CACHE and no conversion values.

Conversion routes use an IP token bucket: 20 requests may burst immediately, then one token refills every three seconds. A 429 response includes Retry-After in seconds.
`;

module.exports = { OPENAPI_DOCUMENT, LLMS_DOCUMENT };
