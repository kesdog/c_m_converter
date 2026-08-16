const fs = require("fs/promises");
const path = require("path");

const CACHE_FILE = "rates-cache.json";
const METALS_CACHE_FILE = "metals-cache.json";
const PRIMARY_API_SITE = "freecurrencyapi.com";
const PRIMARY_METALS_API_SITE = "gold-api.com";
const CACHE_TTL_MS = 60 * 60 * 1000;
const STALE_WARNING_RED_AFTER_MS = 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 10 * 1000;
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
    // Delay loading the optional provider client until a configured request needs it.
    freecurrencyapiClassPromise = import("@everapi/freecurrencyapi-js").then((mod) => mod.default);
  }
  return freecurrencyapiClassPromise;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  // Rename prevents readers from observing a partially written cache file.
  await fs.rename(tempPath, filePath);
}

function getCurrentDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function isFreshTimestamp(timestamp, now = Date.now()) {
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && now - parsed < CACHE_TTL_MS;
}

function getCacheDateFromTimestamp(timestamp) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? getCurrentDateStamp() : parsed.toISOString().slice(0, 10);
}

function getJsonSizeBytes(data) {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

function pruneCurrencyCache(cache = {}) {
  const nextCache = { byBase: { ...((cache && cache.byBase) || {}) } };
  for (const [baseCurrency, entry] of Object.entries(nextCache.byBase)) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !entry.rates ||
      typeof entry.rates !== "object" ||
      !Number.isFinite(new Date(entry.fetchedAt).getTime())
    ) {
      delete nextCache.byBase[baseCurrency];
    }
  }

  // Retain the most recently fetched base currencies if a corrupted or oversized cache appears.
  const entries = Object.entries(nextCache.byBase).sort(([, left], [, right]) => {
    return new Date(left.fetchedAt || 0).getTime() - new Date(right.fetchedAt || 0).getTime();
  });
  while (getJsonSizeBytes(nextCache) > MAX_CACHE_BYTES && entries.length) {
    delete nextCache.byBase[entries.shift()[0]];
  }
  return nextCache;
}

function getMetalTimestamp(priceData, entry) {
  return priceData.fetchedAt || entry.fetchedAt || priceData.updatedAt;
}

function pruneMetalsCache(cache = {}) {
  const nextCache = { byMetal: {} };
  for (const [metalSymbol, entry] of Object.entries((cache && cache.byMetal) || {})) {
    if (!entry || typeof entry !== "object" || !entry.prices || typeof entry.prices !== "object") {
      continue;
    }
    const prices = {};
    for (const [currency, priceData] of Object.entries(entry.prices || {})) {
      const timestamp = getMetalTimestamp(priceData || {}, entry);
      if (
        priceData &&
        typeof priceData === "object" &&
        Number.isFinite(Number(priceData.price)) &&
        Number(priceData.price) > 0 &&
        Number.isFinite(new Date(timestamp).getTime())
      ) {
        prices[currency] = priceData;
      }
    }
    if (Object.keys(prices).length) {
      nextCache.byMetal[metalSymbol] = { ...entry, prices };
    }
  }

  const entries = [];
  for (const [metalSymbol, entry] of Object.entries(nextCache.byMetal)) {
    for (const [currency, priceData] of Object.entries(entry.prices)) {
      entries.push({
        metalSymbol,
        currency,
        timestamp: new Date(getMetalTimestamp(priceData, entry) || 0).getTime()
      });
    }
  }
  entries.sort((left, right) => left.timestamp - right.timestamp);
  while (getJsonSizeBytes(nextCache) > MAX_CACHE_BYTES && entries.length) {
    const oldest = entries.shift();
    const metalEntry = nextCache.byMetal[oldest.metalSymbol];
    delete metalEntry.prices[oldest.currency];
    if (!Object.keys(metalEntry.prices).length) {
      delete nextCache.byMetal[oldest.metalSymbol];
    }
  }
  return nextCache;
}

function resolveApiKey(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || !value.includes("http")) {
    return value;
  }
  try {
    return new URL(value).searchParams.get("apikey") || value;
  } catch {
    const match = value.match(/[?&]apikey=([^&]+)/i);
    return match && match[1] ? decodeURIComponent(match[1]) : value;
  }
}

function getCachePath(rootDir, fileName) {
  return path.join(rootDir, process.env.CACHE_DIR || "data", fileName);
}

function buildWarning(code, message) {
  return { code, message };
}

function buildStaleWarning(dataType, fetchedAt) {
  const ageMs = Math.max(0, Date.now() - new Date(fetchedAt).getTime());
  const severity = ageMs > STALE_WARNING_RED_AFTER_MS ? "red" : "orange";
  const label = dataType === "metal" ? "metal pricing" : "currency rates";
  return {
    code: "LIVE_DATA_UNAVAILABLE_USING_STALE_CACHE",
    severity,
    ageSeconds: Math.floor(ageMs / 1000),
    message: `Live ${label} are unavailable. Using the most recent cached data; values may be stale.`
  };
}

function buildUnavailableError(message) {
  return {
    code: "UPSTREAM_UNAVAILABLE_NO_CACHE",
    message,
    retryable: true
  };
}

function normalizeRates(rawRates, requiredCurrencies = []) {
  if (!rawRates || typeof rawRates !== "object" || Array.isArray(rawRates)) {
    return null;
  }
  const rates = {};
  for (const [code, rawRate] of Object.entries(rawRates)) {
    const rate = Number(rawRate);
    if (Number.isFinite(rate) && rate > 0) {
      rates[code.toUpperCase()] = rate;
    }
  }
  if (requiredCurrencies.some((code) => !Number.isFinite(rates[code]) || rates[code] <= 0)) {
    return null;
  }
  return Object.keys(rates).length ? rates : null;
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Provider request timed out.")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function fetchCurrencyRatesFromProvider({ apiKey, baseCurrency }) {
  if (!apiKey) {
    throw new Error("Currency provider is not configured.");
  }
  return withTimeout(
    (async () => {
      const client = new (await getFreecurrencyapiClass())(apiKey);
      const response = await client.latest({ base_currency: baseCurrency });
      return response && response.data;
    })(),
    PROVIDER_TIMEOUT_MS
  );
}

async function getRatesWithCache({ rootDir, baseCurrency, requiredCurrencies = [], fetchRates }) {
  const cachePath = getCachePath(rootDir, CACHE_FILE);
  const cache = pruneCurrencyCache(await readJson(cachePath, { byBase: {} }));
  const cachedEntry = cache.byBase[baseCurrency];
  const cachedRates = normalizeRates(cachedEntry?.rates, requiredCurrencies);
  if (cachedEntry && cachedRates && isFreshTimestamp(cachedEntry.fetchedAt)) {
    return {
      rates: cachedRates,
      cached: true,
      stale: false,
      degraded: false,
      dataStatus: "fresh-cache",
      warning: null,
      source: cachedEntry.source || "cache",
      sourceSite: cachedEntry.sourceSite || PRIMARY_API_SITE,
      fetchedAt: cachedEntry.fetchedAt,
      cacheDate: getCacheDateFromTimestamp(cachedEntry.fetchedAt)
    };
  }

  const fetchedAt = new Date().toISOString();
  const apiKey = resolveApiKey(process.env.FREECURRENCY_API_KEY || process.env.EXCHANGE_RATE_API_KEY);
  try {
    const rawRates = fetchRates
      ? await fetchRates({ baseCurrency, requiredCurrencies })
      : await fetchCurrencyRatesFromProvider({ apiKey, baseCurrency });
    const rates = normalizeRates(rawRates, requiredCurrencies);
    if (!rates) {
      throw new Error("Currency provider returned incomplete or invalid rates.");
    }
    const nextEntry = {
      baseCurrency,
      rates,
      source: "freecurrencyapi",
      sourceSite: PRIMARY_API_SITE,
      fetchedAt
    };
    let warning = null;
    try {
      cache.byBase[baseCurrency] = nextEntry;
      await writeJsonAtomic(cachePath, pruneCurrencyCache(cache));
    } catch {
      warning = buildWarning(
        "CACHE_WRITE_FAILED",
        "Live currency rates are available, but the latest data could not be saved for later requests."
      );
    }
    return {
      rates,
      cached: false,
      stale: false,
      degraded: Boolean(warning),
      dataStatus: "live",
      warning,
      source: "freecurrencyapi",
      sourceSite: PRIMARY_API_SITE,
      fetchedAt,
      cacheDate: getCacheDateFromTimestamp(fetchedAt)
    };
  } catch {
    if (cachedEntry && cachedRates) {
      return {
        rates: cachedRates,
        cached: true,
        stale: true,
        degraded: true,
        dataStatus: "stale-cache",
        warning: buildStaleWarning("currency", cachedEntry.fetchedAt),
        source: cachedEntry.source || "cache",
        sourceSite: cachedEntry.sourceSite || PRIMARY_API_SITE,
        fetchedAt: cachedEntry.fetchedAt,
        cacheDate: getCacheDateFromTimestamp(cachedEntry.fetchedAt)
      };
    }
    return { error: buildUnavailableError("Live currency rates are unavailable and no cached rates are available.") };
  }
}

async function fetchMetalPriceFromProvider({ metalSymbol, currency, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://api.gold-api.com/price/${encodeURIComponent(metalSymbol)}/${encodeURIComponent(currency)}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      throw new Error(`Metal provider returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMetalPrice(rawPrice, metalSymbol, currency, fetchedAt) {
  if (!rawPrice || typeof rawPrice !== "object") {
    return null;
  }
  const price = Number(rawPrice.price);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  return {
    ...rawPrice,
    currency: rawPrice.currency || currency,
    currencySymbol: rawPrice.currencySymbol || currency,
    exchangeRate: Number.isFinite(Number(rawPrice.exchangeRate)) ? Number(rawPrice.exchangeRate) : 1,
    name: rawPrice.name || metalSymbol,
    price,
    symbol: rawPrice.symbol || metalSymbol,
    fetchedAt
  };
}

async function getMetalPriceWithCache({ rootDir, metalSymbol, currency, fetchPrice, fetchImpl }) {
  const cachePath = getCachePath(rootDir, METALS_CACHE_FILE);
  const cache = pruneMetalsCache(await readJson(cachePath, { byMetal: {} }));
  const metalEntry = cache.byMetal[metalSymbol];
  const cachedPrice = metalEntry && metalEntry.prices && metalEntry.prices[currency];
  const cachedFetchedAt = cachedPrice && getMetalTimestamp(cachedPrice, metalEntry);
  if (cachedPrice && isFreshTimestamp(cachedFetchedAt)) {
    return {
      priceData: cachedPrice,
      cached: true,
      stale: false,
      degraded: false,
      dataStatus: "fresh-cache",
      warning: null,
      source: metalEntry.source || "cache",
      sourceSite: metalEntry.sourceSite || PRIMARY_METALS_API_SITE,
      fetchedAt: cachedFetchedAt,
      cacheDate: getCacheDateFromTimestamp(cachedFetchedAt)
    };
  }

  const fetchedAt = new Date().toISOString();
  try {
    const rawPrice = fetchPrice
      ? await fetchPrice({ metalSymbol, currency })
      : await fetchMetalPriceFromProvider({ metalSymbol, currency, fetchImpl });
    const priceData = normalizeMetalPrice(rawPrice, metalSymbol, currency, fetchedAt);
    if (!priceData) {
      throw new Error("Metal provider returned an invalid price.");
    }
    cache.byMetal[metalSymbol] = {
      prices: { ...(metalEntry?.prices || {}), [currency]: priceData },
      source: "gold-api",
      sourceSite: PRIMARY_METALS_API_SITE,
      fetchedAt
    };
    let warning = null;
    try {
      await writeJsonAtomic(cachePath, pruneMetalsCache(cache));
    } catch {
      warning = buildWarning(
        "CACHE_WRITE_FAILED",
        "Live metal pricing is available, but the latest data could not be saved for later requests."
      );
    }
    return {
      priceData,
      cached: false,
      stale: false,
      degraded: Boolean(warning),
      dataStatus: "live",
      warning,
      source: "gold-api",
      sourceSite: PRIMARY_METALS_API_SITE,
      fetchedAt,
      cacheDate: getCacheDateFromTimestamp(fetchedAt)
    };
  } catch {
    if (cachedPrice && Number.isFinite(Number(cachedPrice.price)) && Number(cachedPrice.price) > 0) {
      return {
        priceData: cachedPrice,
        cached: true,
        stale: true,
        degraded: true,
        dataStatus: "stale-cache",
        warning: buildStaleWarning("metal", cachedFetchedAt),
        source: metalEntry.source || "cache",
        sourceSite: metalEntry.sourceSite || PRIMARY_METALS_API_SITE,
        fetchedAt: cachedFetchedAt,
        cacheDate: getCacheDateFromTimestamp(cachedFetchedAt)
      };
    }
    return { error: buildUnavailableError("Live metal pricing is unavailable and no cached price is available.") };
  }
}

function mapConversions(amount, targetCurrencies, rates) {
  return targetCurrencies.map((code) => {
    const rate = Number(rates[code]);
    return { code, rate, convertedAmount: Number((amount * rate).toFixed(4)) };
  });
}

function buildMetalConversion({ amount, metalSymbol, currency, priceData, unit, operation }) {
  const unitPricePerOunce = Number(priceData.price || 0);
  const unitPricePerGram = Number((unitPricePerOunce / TROY_OUNCE_IN_GRAMS).toFixed(6));
  const unitPrice = unit === "g" ? unitPricePerGram : unitPricePerOunce;
  const outputAmount = Number(
    (operation === "currency-to-metal" ? amount / unitPrice : amount * unitPrice).toFixed(4)
  );
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
    metalAmount: operation === "currency-to-metal" ? outputAmount : amount,
    currencyAmount: operation === "currency-to-metal" ? amount : outputAmount,
    convertedAmount: outputAmount
  };
}

module.exports = {
  CACHE_TTL_MS,
  PROVIDER_TIMEOUT_MS,
  SUPPORTED_METALS,
  SUPPORTED_METAL_UNITS,
  SUPPORTED_METAL_OPERATIONS,
  readJson,
  getRatesWithCache,
  getMetalPriceWithCache,
  mapConversions,
  buildMetalConversion
};
