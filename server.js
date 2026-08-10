const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { appHandler } = require("./httpApp");
const { readJson } = require("./conversionService");

const CURRENCY_FILE = "currencies.json";

async function loadEnvFile(rootDir) {
  try {
    const raw = await fs.readFile(path.join(rootDir, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      const separatorIdx = trimmed.indexOf("=");
      if (!trimmed || trimmed.startsWith("#") || separatorIdx === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIdx).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = trimmed.slice(separatorIdx + 1).trim();
      }
    }
  } catch {
    // The container can be configured entirely through its environment.
  }
}

function createServer(rootDir = process.cwd()) {
  const currenciesPromise = readJson(path.join(rootDir, CURRENCY_FILE), []);
  const productionStaticDir = path.join(rootDir, "dist");
  return http.createServer(
    appHandler(rootDir, currenciesPromise, {
      staticRootDir: require("fs").existsSync(productionStaticDir) ? productionStaticDir : rootDir
    })
  );
}

if (require.main === module) {
  const rootDir = process.cwd();
  loadEnvFile(rootDir).then(() => {
    const server = createServer(rootDir);
    server.listen(Number(process.env.APP_PORT || 3000), () => {
      process.stdout.write(`Server listening on http://localhost:${process.env.APP_PORT || 3000}\n`);
    });
  });
}

module.exports = { createServer, appHandler };
