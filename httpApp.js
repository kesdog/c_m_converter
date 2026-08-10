const fs = require("fs/promises");
const path = require("path");
const {
  normalizeTargets,
  getRawTargetCurrencies,
  validateConversionPayload
} = require("./validation/serverValidation");
const {
  SUPPORTED_METALS,
  SUPPORTED_METAL_UNITS,
  SUPPORTED_METAL_OPERATIONS,
  readJson,
  getRatesWithCache,
  getMetalPriceWithCache,
  mapConversions,
  buildMetalConversion
} = require("./conversionService");
const { createRateLimiter } = require("./rateLimiter");
const { OPENAPI_DOCUMENT, LLMS_DOCUMENT } = require("./agentDiscovery");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};
const MAX_COMPARISONS = 4;
const CURRENCY_FILE = "currencies.json";
const CURRENCY_CONVERSION_ROUTES = new Set(["/convert", "/submit", "/api/agent/v1/currency/convert"]);
const METALS_CONVERSION_ROUTES = new Set(["/convert-metals", "/api/agent/v1/metals/convert"]);

function respondJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function respondText(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

async function readRequestJson(req, res) {
  try {
    return JSON.parse((await readBody(req)) || "{}");
  } catch {
    respondJson(res, 400, { message: "Invalid JSON payload." });
    return null;
  }
}

function rejectRateLimitedRequest(res, rateLimit) {
  respondJson(
    res,
    429,
    { message: "Too many conversion requests. Try again later." },
    { "Retry-After": String(rateLimit.retryAfter) }
  );
}

async function handleCurrencyConversion(req, res, rootDir, currencyDataPromise) {
  const parsed = await readRequestJson(req, res);
  if (!parsed) {
    return;
  }
  const amount = Number(parsed.amount);
  const baseCurrency = String(parsed.baseCurrency || "").toUpperCase().trim();
  const rawTargetCurrencies = getRawTargetCurrencies(parsed.targetCurrencies);
  const targetCurrencies = normalizeTargets(parsed.targetCurrencies);
  const validationMessage = validateConversionPayload({
    amount,
    baseCurrency,
    rawTargetCurrencies,
    targetCurrencies,
    maxComparisons: MAX_COMPARISONS
  });
  if (validationMessage) {
    respondJson(res, 400, { message: validationMessage });
    return;
  }

  const rateResult = await getRatesWithCache({
    rootDir,
    baseCurrency,
    availableCurrencies: (await currencyDataPromise).map((currency) => currency.code)
  });
  respondJson(res, 200, {
    message: `Converted ${amount} ${baseCurrency} into ${targetCurrencies.length} currencies.`,
    cached: rateResult.cached,
    source: rateResult.source,
    sourceSite: rateResult.sourceSite,
    fetchedAt: rateResult.fetchedAt,
    cacheDate: rateResult.cacheDate,
    conversions: mapConversions(amount, targetCurrencies, rateResult.rates)
  });
}

async function handleMetalConversion(req, res, rootDir) {
  const parsed = await readRequestJson(req, res);
  if (!parsed) {
    return;
  }
  const amount = Number(parsed.amount);
  const metalSymbol = String(parsed.metalSymbol || "").toUpperCase().trim();
  const currency = String(parsed.currency || "").toUpperCase().trim();
  const unit = String(parsed.unit || "oz").toLowerCase().trim();
  const operation = String(parsed.operation || "metal-to-currency").toLowerCase().trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    respondJson(res, 400, { message: "Amount must be a positive number." });
    return;
  }
  if (!SUPPORTED_METALS.some((metal) => metal.symbol === metalSymbol)) {
    respondJson(res, 400, { message: "Choose a supported metal." });
    return;
  }
  if (!currency) {
    respondJson(res, 400, { message: "Currency is required." });
    return;
  }
  if (!SUPPORTED_METAL_UNITS.includes(unit)) {
    respondJson(res, 400, { message: "Choose a supported unit." });
    return;
  }
  if (!SUPPORTED_METAL_OPERATIONS.includes(operation)) {
    respondJson(res, 400, { message: "Choose a supported operation." });
    return;
  }

  const rateResult = await getMetalPriceWithCache({ rootDir, metalSymbol, currency });
  respondJson(res, 200, {
    message: `Converted ${amount} ${metalSymbol} into ${currency}.`,
    cached: rateResult.cached,
    source: rateResult.source,
    sourceSite: rateResult.sourceSite,
    fetchedAt: rateResult.fetchedAt,
    cacheDate: rateResult.cacheDate,
    conversion: buildMetalConversion({
      amount,
      metalSymbol,
      currency,
      priceData: rateResult.priceData,
      unit,
      operation
    })
  });
}

async function serveStaticFile(res, rootDir, url) {
  const routePath = url === "/" || url === "/currency" ? "/currency.html" : url === "/metals" ? "/metals.html" : url;
  const filePath = path.join(rootDir, path.normalize(routePath).replace(/^(\.\.[/\\])+/, ""));
  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

function appHandler(rootDir, currenciesPromise, options = {}) {
  const currencyDataPromise = currenciesPromise || readJson(path.join(rootDir, CURRENCY_FILE), []);
  const staticRootDir = options.staticRootDir || rootDir;
  const limitRequest = createRateLimiter({
    trustProxy: options.trustProxy ?? process.env.TRUST_PROXY === "true",
    now: options.now
  });

  return async (req, res) => {
    const url = req.url || "/";
    if (req.method === "GET" && url === "/openapi.json") {
      respondJson(res, 200, OPENAPI_DOCUMENT);
      return;
    }
    if (req.method === "GET" && url === "/llms.txt") {
      respondText(res, 200, LLMS_DOCUMENT);
      return;
    }
    if (req.method === "GET" && (url === "/api/currencies" || url === "/api/agent/v1/currencies")) {
      respondJson(res, 200, { currencies: await currencyDataPromise, maxComparisons: MAX_COMPARISONS });
      return;
    }
    if (req.method === "GET" && (url === "/api/metals" || url === "/api/agent/v1/metals")) {
      respondJson(res, 200, { metals: SUPPORTED_METALS });
      return;
    }
    if (req.method === "POST" && METALS_CONVERSION_ROUTES.has(url)) {
      const rateLimit = limitRequest(req);
      if (!rateLimit.allowed) {
        rejectRateLimitedRequest(res, rateLimit);
        return;
      }
      await handleMetalConversion(req, res, rootDir);
      return;
    }
    if (req.method === "POST" && CURRENCY_CONVERSION_ROUTES.has(url)) {
      const rateLimit = limitRequest(req);
      if (!rateLimit.allowed) {
        rejectRateLimitedRequest(res, rateLimit);
        return;
      }
      await handleCurrencyConversion(req, res, rootDir, currencyDataPromise);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }
    if (staticRootDir === rootDir) {
      await serveStaticFile(res, rootDir, url);
      return;
    }

    const routePath = url === "/" || url === "/currency" ? "/currency.html" : url === "/metals" ? "/metals.html" : url;
    const staticPath = path.join(staticRootDir, path.normalize(routePath).replace(/^(\.\.[/\\])+/, ""));
    try {
      const file = await fs.readFile(staticPath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(staticPath)] || "application/octet-stream" });
      res.end(file);
    } catch {
      await serveStaticFile(res, rootDir, url);
    }
  };
}

module.exports = { appHandler };
