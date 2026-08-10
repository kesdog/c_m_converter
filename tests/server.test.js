const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const { Readable, Writable } = require("node:stream");
const { appHandler } = require("../server");

function runHandler(handler, { method, url, body, headers = {}, remoteAddress = "127.0.0.1" }) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        if (body) {
          this.push(body);
        }
        this.push(null);
      }
    });
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = { remoteAddress };

    const chunks = [];
    const res = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });

    res.statusCode = 200;
    res.headers = {};
    res.writeHead = (statusCode, headers = {}) => {
      res.statusCode = statusCode;
      res.headers = { ...res.headers, ...headers };
      return res;
    };
    res.end = (chunk) => {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("serves index page and accepts form POST", async () => {
  process.env.CACHE_DIR = "data_test_cache";
  const cacheDir = path.join(process.cwd(), process.env.CACHE_DIR);
  const cachePath = path.join(cacheDir, "rates-cache.json");
  await fs.rm(cacheDir, { recursive: true, force: true });

  const handler = appHandler(process.cwd());

  const getResponse = await runHandler(handler, { method: "GET", url: "/" });
  assert.equal(getResponse.statusCode, 200);
  assert.match(getResponse.body, /<title>Currency Converter<\/title>/);
  assert.match(getResponse.body, /id="root"/);

  const currencyPageResponse = await runHandler(handler, { method: "GET", url: "/currency" });
  assert.equal(currencyPageResponse.statusCode, 200);
  assert.match(currencyPageResponse.body, /data-page="currency"/);

  const currenciesResponse = await runHandler(handler, {
    method: "GET",
    url: "/api/currencies"
  });
  assert.equal(currenciesResponse.statusCode, 200);
  const currenciesPayload = JSON.parse(currenciesResponse.body);
  assert.ok(Array.isArray(currenciesPayload.currencies));
  assert.equal(currenciesPayload.maxComparisons, 4);

  const postResponse1 = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({
      amount: "100",
      baseCurrency: "USD",
      targetCurrencies: ["EUR", "JPY"]
    })
  });
  assert.equal(postResponse1.statusCode, 200);
  const payload1 = JSON.parse(postResponse1.body);
  assert.match(payload1.message, /Converted 100 USD into 2 currencies\./);
  assert.equal(payload1.cached, false);
  assert.equal(payload1.conversions.length, 2);

  const postResponse2 = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({
      amount: "100",
      baseCurrency: "USD",
      targetCurrencies: ["EUR", "JPY"]
    })
  });
  assert.equal(postResponse2.statusCode, 200);
  const payload2 = JSON.parse(postResponse2.body);
  assert.equal(payload2.cached, true);

  const expandedTargetsResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({
      amount: "100",
      baseCurrency: "USD",
      targetCurrencies: ["CAD"]
    })
  });
  assert.equal(expandedTargetsResponse.statusCode, 200);
  assert.equal(JSON.parse(expandedTargetsResponse.body).cached, true);

  const duplicateTargetResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({
      amount: "100",
      baseCurrency: "USD",
      targetCurrencies: ["EUR", "EUR"]
    })
  });
  assert.equal(duplicateTargetResponse.statusCode, 400);
  const duplicatePayload = JSON.parse(duplicateTargetResponse.body);
  assert.match(duplicatePayload.message, /Duplicate target currencies are not allowed/);

  const sameAsBaseResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({
      amount: "100",
      baseCurrency: "USD",
      targetCurrencies: ["USD"]
    })
  });
  assert.equal(sameAsBaseResponse.statusCode, 400);
  const sameAsBasePayload = JSON.parse(sameAsBaseResponse.body);
  assert.match(sameAsBasePayload.message, /Target currency cannot match base currency/);

  const cacheRaw = await fs.readFile(cachePath, "utf8");
  const cachePayload = JSON.parse(cacheRaw);
  assert.ok(cachePayload.byBase.USD);
  assert.ok(cachePayload.byBase.USD.fetchedAt);
  assert.match(payload2.cacheDate, /^\d{4}-\d{2}-\d{2}$/);

  delete process.env.CACHE_DIR;
});

test("ignores currency cache entries older than three hours", async () => {
  process.env.CACHE_DIR = "data_test_cache";
  const cacheDir = path.join(process.cwd(), process.env.CACHE_DIR);
  const cachePath = path.join(cacheDir, "rates-cache.json");
  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.mkdir(cacheDir, { recursive: true });

  const staleFetchedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  await fs.writeFile(
    cachePath,
    JSON.stringify(
      {
        byBase: {
          USD: {
            baseCurrency: "USD",
            rates: { EUR: 999 },
            source: "cache",
            sourceSite: "stale-test",
            fetchedAt: staleFetchedAt
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const handler = appHandler(process.cwd());
  const response = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({
      amount: "1",
      baseCurrency: "USD",
      targetCurrencies: ["EUR"]
    })
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.cached, false);
  assert.notEqual(payload.conversions[0].rate, 999);

  delete process.env.CACHE_DIR;
});

test("serves metals page and caches metals results", async () => {
  process.env.CACHE_DIR = "data_test_cache";
  const cacheDir = path.join(process.cwd(), process.env.CACHE_DIR);
  const cachePath = path.join(cacheDir, "metals-cache.json");
  await fs.rm(cacheDir, { recursive: true, force: true });

  const handler = appHandler(process.cwd());

  const getResponse = await runHandler(handler, { method: "GET", url: "/metals" });
  assert.equal(getResponse.statusCode, 200);
  assert.match(getResponse.body, /<title>Metals Converter<\/title>/);
  assert.match(getResponse.body, /data-page="metals"/);

  const metalsResponse = await runHandler(handler, {
    method: "GET",
    url: "/api/metals"
  });
  assert.equal(metalsResponse.statusCode, 200);
  const metalsPayload = JSON.parse(metalsResponse.body);
  assert.deepEqual(
    metalsPayload.metals.map((metal) => metal.symbol),
    ["XAU", "XAG", "HG", "XPT"]
  );

  const postResponse1 = await runHandler(handler, {
    method: "POST",
    url: "/convert-metals",
    body: JSON.stringify({
      amount: "2",
      metalSymbol: "XAU",
      currency: "USD",
      unit: "g",
      operation: "metal-to-currency"
    })
  });
  assert.equal(postResponse1.statusCode, 200);
  const payload1 = JSON.parse(postResponse1.body);
  assert.equal(payload1.cached, false);
  assert.equal(payload1.conversion.metalSymbol, "XAU");
  assert.equal(payload1.conversion.currency, "USD");
  assert.equal(payload1.conversion.operation, "metal-to-currency");
  assert.equal(payload1.conversion.unit, "g");
  assert.equal(payload1.conversion.metalAmount, 2);
  assert.equal(typeof payload1.conversion.unitPricePerOunce, "number");
  assert.equal(typeof payload1.conversion.unitPricePerGram, "number");
  assert.equal(typeof payload1.conversion.unitPrice, "number");
  assert.equal(typeof payload1.conversion.outputAmount, "number");
  assert.equal(typeof payload1.conversion.currencyAmount, "number");
  assert.equal(
    payload1.conversion.unitPricePerGram,
    Number((payload1.conversion.unitPricePerOunce / 31.1034768).toFixed(6))
  );
  assert.equal(payload1.conversion.unitPrice, payload1.conversion.unitPricePerGram);
  assert.equal(
    payload1.conversion.outputAmount,
    Number((2 * payload1.conversion.unitPricePerGram).toFixed(4))
  );
  assert.equal(payload1.conversion.currencyAmount, payload1.conversion.outputAmount);

  const postResponse2 = await runHandler(handler, {
    method: "POST",
    url: "/convert-metals",
    body: JSON.stringify({
      amount: "2",
      metalSymbol: "XAU",
      currency: "USD",
      unit: "g",
      operation: "metal-to-currency"
    })
  });
  assert.equal(postResponse2.statusCode, 200);
  const payload2 = JSON.parse(postResponse2.body);
  assert.equal(payload2.cached, true);
  assert.equal(
    payload2.conversion.unitPricePerGram,
    Number((payload2.conversion.unitPricePerOunce / 31.1034768).toFixed(6))
  );

  const reverseResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert-metals",
    body: JSON.stringify({
      amount: "1000",
      metalSymbol: "XAU",
      currency: "USD",
      unit: "oz",
      operation: "currency-to-metal"
    })
  });
  assert.equal(reverseResponse.statusCode, 200);
  const reversePayload = JSON.parse(reverseResponse.body);
  assert.equal(reversePayload.cached, true);
  assert.equal(reversePayload.conversion.operation, "currency-to-metal");
  assert.equal(reversePayload.conversion.unit, "oz");
  assert.equal(reversePayload.conversion.currencyAmount, 1000);
  assert.equal(
    reversePayload.conversion.outputAmount,
    Number((1000 / reversePayload.conversion.unitPricePerOunce).toFixed(4))
  );
  assert.equal(reversePayload.conversion.metalAmount, reversePayload.conversion.outputAmount);

  const invalidMetalResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert-metals",
    body: JSON.stringify({
      amount: "2",
      metalSymbol: "TIN",
      currency: "USD"
    })
  });
  assert.equal(invalidMetalResponse.statusCode, 400);
  const invalidMetalPayload = JSON.parse(invalidMetalResponse.body);
  assert.match(invalidMetalPayload.message, /supported metal/i);

  const invalidUnitResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert-metals",
    body: JSON.stringify({
      amount: "2",
      metalSymbol: "XAU",
      currency: "USD",
      unit: "kg"
    })
  });
  assert.equal(invalidUnitResponse.statusCode, 400);
  const invalidUnitPayload = JSON.parse(invalidUnitResponse.body);
  assert.match(invalidUnitPayload.message, /supported unit/i);

  const cacheRaw = await fs.readFile(cachePath, "utf8");
  const cachePayload = JSON.parse(cacheRaw);
  assert.ok(cachePayload.byMetal.XAU);
  assert.ok(cachePayload.byMetal.XAU.prices.USD);
  assert.ok(cachePayload.byMetal.XAU.prices.USD.fetchedAt);

  delete process.env.CACHE_DIR;
});

test("ignores metals cache entries older than three hours", async () => {
  process.env.CACHE_DIR = "data_test_cache";
  const cacheDir = path.join(process.cwd(), process.env.CACHE_DIR);
  const cachePath = path.join(cacheDir, "metals-cache.json");
  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.mkdir(cacheDir, { recursive: true });

  const staleUpdatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  await fs.writeFile(
    cachePath,
    JSON.stringify(
      {
        byMetal: {
          XAU: {
            source: "cache",
            sourceSite: "stale-test",
            fetchedAt: staleUpdatedAt,
            prices: {
              USD: {
                currency: "USD",
                currencySymbol: "$",
                exchangeRate: 1,
                name: "Gold",
                price: 1,
                symbol: "XAU",
                updatedAt: staleUpdatedAt,
                fetchedAt: staleUpdatedAt
              }
            }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const handler = appHandler(process.cwd());
  const response = await runHandler(handler, {
    method: "POST",
    url: "/convert-metals",
    body: JSON.stringify({
      amount: "1",
      metalSymbol: "XAU",
      currency: "USD",
      unit: "oz",
      operation: "metal-to-currency"
    })
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.cached, false);
  assert.notEqual(payload.conversion.unitPricePerOunce, 1);

  delete process.env.CACHE_DIR;
});

test("serves agent discovery documents and shares conversion cache with the web routes", async () => {
  process.env.CACHE_DIR = "data_test_cache";
  const cacheDir = path.join(process.cwd(), process.env.CACHE_DIR);
  await fs.rm(cacheDir, { recursive: true, force: true });

  const handler = appHandler(process.cwd());
  const openApiResponse = await runHandler(handler, { method: "GET", url: "/openapi.json" });
  assert.equal(openApiResponse.statusCode, 200);
  const openApi = JSON.parse(openApiResponse.body);
  assert.ok(openApi.paths["/api/agent/v1/currency/convert"]);
  assert.ok(openApi.paths["/api/agent/v1/metals/convert"]);

  const llmsResponse = await runHandler(handler, { method: "GET", url: "/llms.txt" });
  assert.equal(llmsResponse.statusCode, 200);
  assert.match(llmsResponse.body, /\/api\/agent\/v1\/currency\/convert/);

  const agentCurrenciesResponse = await runHandler(handler, {
    method: "GET",
    url: "/api/agent/v1/currencies"
  });
  assert.equal(agentCurrenciesResponse.statusCode, 200);
  assert.ok(JSON.parse(agentCurrenciesResponse.body).currencies.length > 0);

  const agentResponse = await runHandler(handler, {
    method: "POST",
    url: "/api/agent/v1/currency/convert",
    body: JSON.stringify({ amount: 10, baseCurrency: "USD", targetCurrencies: ["EUR"] })
  });
  assert.equal(agentResponse.statusCode, 200);
  const agentPayload = JSON.parse(agentResponse.body);
  assert.equal(agentPayload.cached, false);

  const webResponse = await runHandler(handler, {
    method: "POST",
    url: "/convert",
    body: JSON.stringify({ amount: 10, baseCurrency: "USD", targetCurrencies: ["EUR"] })
  });
  assert.equal(webResponse.statusCode, 200);
  const webPayload = JSON.parse(webResponse.body);
  assert.equal(webPayload.cached, true);
  assert.deepEqual(webPayload.conversions, agentPayload.conversions);

  const agentMetalsResponse = await runHandler(handler, {
    method: "GET",
    url: "/api/agent/v1/metals"
  });
  assert.equal(agentMetalsResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(agentMetalsResponse.body).metals.map((metal) => metal.symbol), [
    "XAU",
    "XAG",
    "HG",
    "XPT"
  ]);

  delete process.env.CACHE_DIR;
});

test("limits conversion requests with per-IP token buckets", async () => {
  process.env.CACHE_DIR = "data_test_cache";
  const cacheDir = path.join(process.cwd(), process.env.CACHE_DIR);
  await fs.rm(cacheDir, { recursive: true, force: true });

  let currentTime = 0;
  const handler = appHandler(process.cwd(), undefined, {
    now: () => currentTime,
    trustProxy: true
  });
  const request = {
    method: "POST",
    url: "/api/agent/v1/currency/convert",
    headers: { "x-real-ip": "203.0.113.10" },
    body: JSON.stringify({ amount: 1, baseCurrency: "USD", targetCurrencies: ["EUR"] })
  };

  for (let index = 0; index < 20; index += 1) {
    assert.equal((await runHandler(handler, request)).statusCode, 200);
  }

  const limitedResponse = await runHandler(handler, request);
  assert.equal(limitedResponse.statusCode, 429);
  assert.equal(limitedResponse.headers["Retry-After"], "3");

  const otherIpResponse = await runHandler(handler, {
    ...request,
    headers: { "x-real-ip": "203.0.113.11" }
  });
  assert.equal(otherIpResponse.statusCode, 200);

  currentTime += 3 * 1000;
  assert.equal((await runHandler(handler, request)).statusCode, 200);

  delete process.env.CACHE_DIR;
});
