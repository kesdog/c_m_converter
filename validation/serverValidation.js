function normalizeTargets(targetCurrencies) {
  if (!Array.isArray(targetCurrencies)) {
    return [];
  }
  const normalized = targetCurrencies
    .map((code) => String(code || "").toUpperCase().trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function getRawTargetCurrencies(targetCurrencies) {
  if (!Array.isArray(targetCurrencies)) {
    return [];
  }
  return targetCurrencies
    .map((code) => String(code || "").toUpperCase().trim())
    .filter(Boolean);
}

function validateConversionPayload({
  amount,
  baseCurrency,
  rawTargetCurrencies,
  targetCurrencies,
  maxComparisons
}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Amount must be a positive number.";
  }
  if (!baseCurrency) {
    return "Base currency is required.";
  }
  if (!targetCurrencies.length) {
    return "Choose at least one target currency.";
  }
  if (rawTargetCurrencies.length !== targetCurrencies.length) {
    return "Duplicate target currencies are not allowed.";
  }
  if (targetCurrencies.includes(baseCurrency)) {
    return "Target currency cannot match base currency.";
  }
  if (targetCurrencies.length > maxComparisons) {
    return `Select up to ${maxComparisons} target currencies at once.`;
  }
  return null;
}

module.exports = {
  normalizeTargets,
  getRawTargetCurrencies,
  validateConversionPayload
};
