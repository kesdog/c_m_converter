export function validateResolvedTargets({
  targetCurrencies,
  baseCurrency,
  maxComparisons
}) {
  if (targetCurrencies.includes(baseCurrency)) {
    return { ok: false, errorKey: "messageSameAsBase" };
  }

  const uniqueTargets = Array.from(new Set(targetCurrencies));
  if (uniqueTargets.length !== targetCurrencies.length) {
    return { ok: false, errorKey: "messageDuplicateTarget" };
  }
  if (!uniqueTargets.length) {
    return { ok: false, errorKey: "messageNeedTarget" };
  }
  if (uniqueTargets.length > maxComparisons) {
    return { ok: false, errorKey: "messageMaxComparisons" };
  }

  return { ok: true, uniqueTargets };
}

export function hasUnresolvedTargetEntries(targetBlocks, resolveCurrencyCode) {
  return targetBlocks.some(
    (block) => block.getRawValue() && !block.getCode(resolveCurrencyCode)
  );
}

export function hasDuplicateSelectedCode(targetBlocks, changedBlock, resolveCurrencyCode) {
  const selectedCode = changedBlock.getCode(resolveCurrencyCode);
  if (!selectedCode) {
    return false;
  }
  return targetBlocks.some(
    (block) =>
      block !== changedBlock && block.getCode(resolveCurrencyCode) === selectedCode
  );
}
