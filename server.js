const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const {
  normalizeTargets,
  getRawTargetCurrencies,
  validateConversionPayload
} = require("./validation/serverValidation");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const MAX_COMPARISONS = 4;
const CURRENCY_FILE = "currencies.json";
const CACHE_FILE = "rates-cache.json";
const METALS_CACHE_FILE = "metals-cache.json";
const PRIMARY_API_SITE = "freecurrencyapi.com";
const PRIMARY_METALS_API_SITE = "gold-api.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 25 * 1024 * 1024;
const TROY_OUNCE_IN_GRAMS = 31.1034768;
const SUPPORTED_METAL_UNITS = ["oz", "g"];
const SUPPORTED_METAL_OPERATIONS = ["metal-to-currency", "currency-to-metal"];
const SUPPORTED_METALS = [
  { symbol: "XAU", name: "Gold" },
  { symbol: "XAG", name: "Silver" },
  { symbol: "HG", name: "Copper" },
  { symbol: "XPT", name: "Platinum" }
];

let freecurrencyapiClassPromise = null;

async function getFreecurrencyapiClass() {
  if (!freecurrencyapiClassPromise) {
    freecurrencyapiClassPromise = import("@everapi/freecurrencyapi-js").then(
      (mod) => mod.default
    );
  }
  return freecurrencyapiClassPromise;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadEnvFile(rootDir) {
  const envPath = path.join(rootDir, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIdx = trimmed.indexOf("=");
      if (separatorIdx === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIdx).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      const value = trimmed.slice(separatorIdx + 1).trim();
      process.env[key] = value;
    }
  } catch {
    // Optional file.
  }
}

async function writeJsonAtomic(filePath, data) {
  const dirPath = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const raw = JSON.stringify(data, null, 2);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(tempPath, raw, "utf8");
  await fs.rename(tempPath, filePath);
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      resolve(body);
    });
  });
}

function getCurrentDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function isFreshTimestamp(timestamp, now = Date.now()) {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return now - parsed < CACHE_TTL_MS;
}

function getCacheDateFromTimestamp(timestamp) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return getCurrentDateStamp();
  }
  return parsed.toISOString().slice(0, 10);
}

function getJsonSizeBytes(data) {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

function pruneCurrencyCache(cache, now = Date.now()) {
  const nextCache = { byBase: { ...(cache.byBase || {}) } };

  for (const [baseCurrency, entry] of Object.entries(nextCache.byBase)) {
    if (!entry || !entry.fetchedAt || !isFreshTimestamp(entry.fetchedAt, now)) {
      delete nextCache.byBase[baseCurrency];
    }
  }

  if (getJsonSizeBytes(nextCache) <= MAX_CACHE_BYTES) {
    return nextCache;
  }

  const sortedEntries = Object.entries(nextCache.byBase).sort(([, left], [, right]) => {
    return new Date(left.fetchedAt || 0).getTime() - new Date(right.fetchedAt || 0).getTime();
  });

  for (const [baseCurrency] of sortedEntries) {
    if (getJsonSizeBytes(nextCache) <= MAX_CACHE_BYTES) {
      break;
    }
    delete nextCache.byBase[baseCurrency];
  }

  return nextCache;
}

function pruneMetalsCache(cache, now = Date.now()) {
  const nextCache = { byMetal: {} };

  for (const [metalSymbol, entry] of Object.entries(cache.byMetal || {})) {
    const prices = {};
    for (const [currency, priceData] of Object.entries(entry.prices || {})) {
      const freshnessSource = priceData.updatedAt || priceData.fetchedAt || entry.fetchedAt;
      if (freshnessSource && isFreshTimestamp(freshnessSource, now)) {
        prices[currency] = priceData;
      }
    }

    if (Object.keys(prices).length > 0) {
      nextCache.byMetal[metalSymbol] = {
        ...entry,
        prices
      };
    }
  }

  if (getJsonSizeBytes(nextCache) <= MAX_CACHE_BYTES) {
    return nextCache;
  }

  const nestedEntries = [];
  for (const [metalSymbol, entry] of Object.entries(nextCache.byMetal)) {
    for (const [currency, priceData] of Object.entries(entry.prices || {})) {
      nestedEntries.push({
        metalSymbol,
        currency,
        timestamp: new Date(priceData.updatedAt || priceData.fetchedAt || entry.fetchedAt || 0).getTime()
      });
    }
  }
  nestedEntries.sort((left, right) => left.timestamp - right.timestamp);

  for (const entry of nestedEntries) {
    if (getJsonSizeBytes(nextCache) <= MAX_CACHE_BYTES) {
      break;
    }
    const metalEntry = nextCache.byMetal[entry.metalSymbol];
    if (!metalEntry) {
      continue;
    }
    delete metalEntry.prices[entry.currency];
    if (Object.keys(metalEntry.prices).length === 0) {
      delete nextCache.byMetal[entry.metalSymbol];
    }
  }

  return nextCache;
}

function resolveApiKey(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  if (!value.includes("http")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    const queryKey = parsed.searchParams.get("apikey");
    if (queryKey) {
      return queryKey;
    }
  } catch {
    const match = value.match(/[?&]apikey=([^&]+)/i);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return value;
}

function buildMockRates(baseCurrency, targetCurrencies) {
  const seed = baseCurrency.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const rates = {};
  for (const code of targetCurrencies) {
    const codeSeed = code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const value = ((seed + codeSeed) % 250) / 100 + 0.5;
    rates[code] = Number(value.toFixed(6));
  }
  return rates;
}

function buildMockMetalPrice(metalSymbol, currency) {
  const seed = `${metalSymbol}:${currency}`
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const price = Number((((seed % 9000) + 1000) / 10).toFixed(4));
  const metal = SUPPORTED_METALS.find((entry) => entry.symbol === metalSymbol);

  return {
    currency,
    currencySymbol: currency,
    exchangeRate: 1,
    name: metal ? metal.name : metalSymbol,
    price,
    symbol: metalSymbol,
    updatedAt: new Date().toISOString()
  };
}

async function getRatesWithCache({ rootDir, baseCurrency, targetCurrencies }) {
  const cacheDirName = process.env.CACHE_DIR || "data";
  const dataDir = path.join(rootDir, cacheDirName);
  const cachePath = path.join(dataDir, CACHE_FILE);
  await fs.mkdir(dataDir, { recursive: true });

  const cache = pruneCurrencyCache(await readJson(cachePath, { byBase: {} }));
  const existingForBase = cache.byBase[baseCurrency];
  const existingRates = existingForBase ? existingForBase.rates || {} : {};
  const missingTargets = targetCurrencies.filter((code) => existingRates[code] === undefined);

  if (existingForBase && missingTargets.length === 0) {
    return {
      rates: existingRates,
      cached: true,
      source: existingForBase.source || "cache",
      sourceSite: existingForBase.sourceSite || PRIMARY_API_SITE,
      fetchedAt: existingForBase.fetchedAt || new Date().toISOString(),
      cacheDate: getCacheDateFromTimestamp(existingForBase.fetchedAt)
    };
  }

  const rawApiKey =
    process.env.FREECURRENCY_API_KEY || process.env.EXCHANGE_RATE_API_KEY || "";
  const apiKey = resolveApiKey(rawApiKey);
  let rates = null;
  let source = "mock";
  let sourceSite = "local-mock";
  const fetchedAt = new Date().toISOString();

  if (apiKey && missingTargets.length > 0) {
    try {
      const Freecurrencyapi = await getFreecurrencyapiClass();
      const client = new Freecurrencyapi(apiKey);
      const response = await client.latest({
        base_currency: baseCurrency,
        currencies: missingTargets.join(",")
      });
      if (response && response.data && typeof response.data === "object") {
        rates = response.data;
        source = "freecurrencyapi";
        sourceSite = PRIMARY_API_SITE;
      }
    } catch {
      rates = null;
    }
  }

  if (!rates) {
    rates = buildMockRates(baseCurrency, missingTargets);
  }

  const mergedRates = { ...existingRates, ...rates };
  cache.byBase[baseCurrency] = {
    baseCurrency,
    rates: mergedRates,
    source,
    sourceSite,
    fetchedAt
  };
  await writeJsonAtomic(cachePath, pruneCurrencyCache(cache));

  return {
    rates: mergedRates,
    cached: false,
    source,
    sourceSite,
    fetchedAt,
    cacheDate: getCacheDateFromTimestamp(fetchedAt)
  };
}

async function getMetalPriceWithCache({ rootDir, metalSymbol, currency }) {
  const cacheDirName = process.env.CACHE_DIR || "data";
  const dataDir = path.join(rootDir, cacheDirName);
  const cachePath = path.join(dataDir, METALS_CACHE_FILE);
  await fs.mkdir(dataDir, { recursive: true });

  const cache = pruneMetalsCache(await readJson(cachePath, { byMetal: {} }));
  const existingForMetal = cache.byMetal[metalSymbol];
  const existingPrices = existingForMetal ? existingForMetal.prices || {} : {};
  const cachedPrice = existingPrices[currency];

  if (cachedPrice) {
    return {
      priceData: cachedPrice,
      cached: true,
      source: existingForMetal.source || "cache",
      sourceSite: existingForMetal.sourceSite || PRIMARY_METALS_API_SITE,
      fetchedAt: cachedPrice.updatedAt || existingForMetal.fetchedAt || new Date().toISOString(),
      cacheDate: getCacheDateFromTimestamp(
        cachedPrice.updatedAt || cachedPrice.fetchedAt || existingForMetal.fetchedAt
      )
    };
  }

  let priceData = null;
  let source = "gold-api";
  let sourceSite = PRIMARY_METALS_API_SITE;
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(
      `https://api.gold-api.com/price/${encodeURIComponent(metalSymbol)}/${encodeURIComponent(
        currency
      )}`
    );
    if (response.ok) {
      const payload = await response.json();
      if (payload && typeof payload.price === "number") {
        priceData = payload;
      }
    }
  } catch {
    priceData = null;
  }

  if (!priceData) {
    priceData = buildMockMetalPrice(metalSymbol, currency);
    source = "mock";
    sourceSite = "local-mock";
  }

  const nextPriceData = {
    ...priceData,
    fetchedAt: priceData.fetchedAt || priceData.updatedAt || fetchedAt
  };

  cache.byMetal[metalSymbol] = {
    prices: {
      ...existingPrices,
      [currency]: nextPriceData
    },
    source,
    sourceSite,
    fetchedAt: nextPriceData.fetchedAt
  };
  await writeJsonAtomic(cachePath, pruneMetalsCache(cache));

  return {
    priceData: nextPriceData,
    cached: false,
    source,
    sourceSite,
    fetchedAt: nextPriceData.fetchedAt,
    cacheDate: getCacheDateFromTimestamp(nextPriceData.fetchedAt)
  };
}

function mapConversions(amount, targetCurrencies, rates) {
  return targetCurrencies.map((code) => {
    const rate = Number(rates[code] || 0);
    return {
      code,
      rate,
      convertedAmount: Number((amount * rate).toFixed(4))
    };
  });
}

function buildMetalConversion({ amount, metalSymbol, currency, priceData, unit, operation }) {
  const unitPricePerOunce = Number(priceData.price || 0);
  const unitPricePerGram = Number((unitPricePerOunce / TROY_OUNCE_IN_GRAMS).toFixed(6));
  const unitPrice = unit === "g" ? unitPricePerGram : unitPricePerOunce;
  const outputAmount =
    operation === "currency-to-metal"
      ? Number((amount / unitPrice).toFixed(4))
      : Number((amount * unitPrice).toFixed(4));
  const metalAmount = operation === "currency-to-metal" ? outputAmount : amount;
  const currencyAmount = operation === "currency-to-metal" ? amount : outputAmount;

  return {
    metalSymbol,
    metalName: priceData.name || metalSymbol,
    currency,
    currencySymbol: priceData.currencySymbol || currency,
    operation,
    unit,
    inputAmount: amount,
    exchangeRate: Number(priceData.exchangeRate || 0),
    unitPricePerOunce,
    unitPricePerGram,
    unitPrice,
    outputAmount,
    metalAmount,
    currencyAmount,
    convertedAmount: outputAmount
  };
}

function appHandler(rootDir, currenciesPromise) {
  const currencyDataPromise =
    currenciesPromise || readJson(path.join(rootDir, CURRENCY_FILE), []);

  return async (req, res) => {
    const url = req.url || "/";

    if (req.method === "GET" && url === "/api/currencies") {
      const currencies = await currencyDataPromise;
      respondJson(res, 200, { currencies, maxComparisons: MAX_COMPARISONS });
      return;
    }

    if (req.method === "GET" && url === "/api/metals") {
      respondJson(res, 200, { metals: SUPPORTED_METALS });
      return;
    }

    if (req.method === "POST" && url === "/convert-metals") {
      const rawBody = await readBody(req);
      let parsed = {};
      try {
        parsed = JSON.parse(rawBody || "{}");
      } catch {
        respondJson(res, 400, { message: "Invalid JSON payload." });
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

      const rateResult = await getMetalPriceWithCache({
        rootDir,
        metalSymbol,
        currency
      });
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
      return;
    }

    if (req.method === "POST" && (url === "/convert" || url === "/submit")) {
      const rawBody = await readBody(req);
      let parsed = {};
      try {
        parsed = JSON.parse(rawBody || "{}");
      } catch {
        respondJson(res, 400, { message: "Invalid JSON payload." });
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
        respondJson(res, 400, {
          message: validationMessage
        });
        return;
      }

      const rateResult = await getRatesWithCache({
        rootDir,
        baseCurrency,
        targetCurrencies
      });
      const conversions = mapConversions(amount, targetCurrencies, rateResult.rates);
      respondJson(res, 200, {
        message: `Converted ${amount} ${baseCurrency} into ${targetCurrencies.length} currencies.`,
        cached: rateResult.cached,
        source: rateResult.source,
        sourceSite: rateResult.sourceSite,
        fetchedAt: rateResult.fetchedAt,
        cacheDate: rateResult.cacheDate,
        conversions
      });
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    const routePath =
      url === "/"
        ? "/currency.html"
        : url === "/currency"
          ? "/currency.html"
          : url === "/metals"
            ? "/metals.html"
            : url;
    const sanitized = path.normalize(routePath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(rootDir, sanitized);

    try {
      const file = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(file);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    }
  };
}

function createServer(rootDir = process.cwd()) {
  const currenciesPromise = readJson(path.join(rootDir, CURRENCY_FILE), []);
  return http.createServer(appHandler(rootDir, currenciesPromise));
}

if (require.main === module) {
  const rootDir = process.cwd();
  loadEnvFile(rootDir).then(() => {
    const port = Number(process.env.APP_PORT || 3000);
    const server = createServer(rootDir);
    server.listen(port, () => {
      process.stdout.write(`Server listening on http://localhost:${port}\n`);
    });
  });
}

module.exports = { createServer, appHandler };
