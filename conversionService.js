const fs = require("fs/promises");
const path = require("path");

const CACHE_FILE = "rates-cache.json";
const METALS_CACHE_FILE = "metals-cache.json";
const PRIMARY_API_SITE = "freecurrencyapi.com";
const PRIMARY_METALS_API_SITE = "gold-api.com";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
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

function pruneCurrencyCache(cache, now = Date.now()) {
  const nextCache = { byBase: { ...(cache.byBase || {}) } };
  for (const [baseCurrency, entry] of Object.entries(nextCache.byBase)) {
    if (!entry || !isFreshTimestamp(entry.fetchedAt, now)) {
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

function pruneMetalsCache(cache, now = Date.now()) {
  const nextCache = { byMetal: {} };
  for (const [metalSymbol, entry] of Object.entries(cache.byMetal || {})) {
    const prices = {};
    for (const [currency, priceData] of Object.entries(entry.prices || {})) {
      const timestamp = priceData.updatedAt || priceData.fetchedAt || entry.fetchedAt;
      if (isFreshTimestamp(timestamp, now)) {
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
        timestamp: new Date(priceData.updatedAt || priceData.fetchedAt || entry.fetchedAt || 0).getTime()
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

function buildMockRates(baseCurrency, targetCurrencies) {
  const seed = baseCurrency.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Object.fromEntries(
    targetCurrencies.map((code) => {
      const codeSeed = code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return [code, Number((((seed + codeSeed) % 250 / 100 + 0.5).toFixed(6)))];
    })
  );
}

function buildMockMetalPrice(metalSymbol, currency) {
  const seed = `${metalSymbol}:${currency}`
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const metal = SUPPORTED_METALS.find((entry) => entry.symbol === metalSymbol);
  return {
    currency,
    currencySymbol: currency,
    exchangeRate: 1,
    name: metal ? metal.name : metalSymbol,
    price: Number((((seed % 9000) + 1000) / 10).toFixed(4)),
    symbol: metalSymbol,
    updatedAt: new Date().toISOString()
  };
}

function getCachePath(rootDir, fileName) {
  return path.join(rootDir, process.env.CACHE_DIR || "data", fileName);
}

async function getRatesWithCache({ rootDir, baseCurrency, availableCurrencies }) {
  const cachePath = getCachePath(rootDir, CACHE_FILE);
  const cache = pruneCurrencyCache(await readJson(cachePath, { byBase: {} }));
  const cachedEntry = cache.byBase[baseCurrency];
  if (cachedEntry) {
    return {
      rates: cachedEntry.rates || {},
      cached: true,
      source: cachedEntry.source || "cache",
      sourceSite: cachedEntry.sourceSite || PRIMARY_API_SITE,
      fetchedAt: cachedEntry.fetchedAt,
      cacheDate: getCacheDateFromTimestamp(cachedEntry.fetchedAt)
    };
  }

  const fetchedAt = new Date().toISOString();
  let rates = null;
  let source = "mock";
  let sourceSite = "local-mock";
  const apiKey = resolveApiKey(process.env.FREECURRENCY_API_KEY || process.env.EXCHANGE_RATE_API_KEY);
  if (apiKey) {
    try {
      const client = new (await getFreecurrencyapiClass())(apiKey);
      // Omitting currencies fetches the provider's complete set in one call per base currency.
      const response = await client.latest({ base_currency: baseCurrency });
      if (response && response.data && typeof response.data === "object") {
        rates = response.data;
        source = "freecurrencyapi";
        sourceSite = PRIMARY_API_SITE;
      }
    } catch {
      rates = null;
    }
  }
  rates = rates || buildMockRates(baseCurrency, availableCurrencies);
  cache.byBase[baseCurrency] = { baseCurrency, rates, source, sourceSite, fetchedAt };
  await writeJsonAtomic(cachePath, pruneCurrencyCache(cache));
  return { rates, cached: false, source, sourceSite, fetchedAt, cacheDate: getCacheDateFromTimestamp(fetchedAt) };
}

async function getMetalPriceWithCache({ rootDir, metalSymbol, currency }) {
  const cachePath = getCachePath(rootDir, METALS_CACHE_FILE);
  const cache = pruneMetalsCache(await readJson(cachePath, { byMetal: {} }));
  const metalEntry = cache.byMetal[metalSymbol];
  const cachedPrice = metalEntry && metalEntry.prices && metalEntry.prices[currency];
  if (cachedPrice) {
    const fetchedAt = cachedPrice.updatedAt || cachedPrice.fetchedAt || metalEntry.fetchedAt;
    return {
      priceData: cachedPrice,
      cached: true,
      source: metalEntry.source || "cache",
      sourceSite: metalEntry.sourceSite || PRIMARY_METALS_API_SITE,
      fetchedAt,
      cacheDate: getCacheDateFromTimestamp(fetchedAt)
    };
  }

  const fetchedAt = new Date().toISOString();
  let priceData = null;
  let source = "gold-api";
  let sourceSite = PRIMARY_METALS_API_SITE;
  try {
    const response = await fetch(
      `https://api.gold-api.com/price/${encodeURIComponent(metalSymbol)}/${encodeURIComponent(currency)}`
    );
    const payload = response.ok ? await response.json() : null;
    if (payload && typeof payload.price === "number") {
      priceData = payload;
    }
  } catch {
    priceData = null;
  }
  if (!priceData) {
    priceData = buildMockMetalPrice(metalSymbol, currency);
    source = "mock";
    sourceSite = "local-mock";
  }

  const nextPriceData = { ...priceData, fetchedAt: priceData.fetchedAt || priceData.updatedAt || fetchedAt };
  cache.byMetal[metalSymbol] = {
    prices: { ...(metalEntry?.prices || {}), [currency]: nextPriceData },
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
  SUPPORTED_METALS,
  SUPPORTED_METAL_UNITS,
  SUPPORTED_METAL_OPERATIONS,
  readJson,
  getRatesWithCache,
  getMetalPriceWithCache,
  mapConversions,
  buildMetalConversion
};
