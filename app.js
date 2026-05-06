import { createTargetBlock, refreshTargetBlockLabels } from "./ui/targetBlock.js";
import {
  hasDuplicateSelectedCode,
  hasUnresolvedTargetEntries,
  validateResolvedTargets
} from "./validation/clientValidation.js";

const DEFAULT_MAX_COMPARISONS = 4;
const LANG_STORAGE_KEY = "app_lang";
const DEFAULT_LANGUAGE = "en";
const TROY_OUNCE_IN_GRAMS = 31.1034768;
const SUPPORTED_LANGUAGES = ["en", "fr", "de", "es"];
const LANGUAGE_META = {
  en: { flag: "🇬🇧", htmlLang: "en-GB" },
  fr: { flag: "🇫🇷", htmlLang: "fr-FR" },
  de: { flag: "🇩🇪", htmlLang: "de-DE" },
  es: { flag: "🇪🇸", htmlLang: "es-ES" }
};

function getSelectedLanguage() {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.includes(stored)) {
    return stored;
  }
  return DEFAULT_LANGUAGE;
}

function interpolate(template, variables = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    return variables[key] !== undefined ? String(variables[key]) : `{${key}}`;
  });
}

function makeTranslator(dictionary) {
  return (key, variables) => interpolate(dictionary[key], variables);
}

function makeField({ id, label, type = "text", full = false, placeholder = "" }) {
  const wrapper = document.createElement("div");
  wrapper.className = `field${full ? " field--full" : ""}`;

  const fieldLabel = document.createElement("label");
  fieldLabel.htmlFor = id;
  fieldLabel.textContent = label;

  const input = document.createElement("input");
  input.id = id;
  input.name = id;
  input.type = type;
  input.placeholder = placeholder;

  wrapper.append(fieldLabel, input);
  return { wrapper, input };
}

function setFieldCompact(field) {
  field.wrapper.classList.add("field--compact");
}

function makeSelectField({ id, label, full = false }) {
  const wrapper = document.createElement("div");
  wrapper.className = `field${full ? " field--full" : ""}`;

  const fieldLabel = document.createElement("label");
  fieldLabel.htmlFor = id;
  fieldLabel.textContent = label;

  const select = document.createElement("select");
  select.id = id;
  select.name = id;

  wrapper.append(fieldLabel, select);
  return { wrapper, select };
}

function fillCurrencyOptions(selectEl, list) {
  selectEl.innerHTML = "";
  for (const currency of list) {
    const option = document.createElement("option");
    option.value = currency.code;
    option.textContent = `${currency.code} - ${currency.name}`;
    selectEl.append(option);
  }
}

function fillMetalOptions(selectEl, list) {
  selectEl.innerHTML = "";
  for (const metal of list) {
    const option = document.createElement("option");
    option.value = metal.symbol;
    option.textContent = metal.name;
    selectEl.append(option);
  }
}

function renderConversionList(container, conversions) {
  container.innerHTML = "";
  for (const row of conversions) {
    const item = document.createElement("li");
    item.textContent = `${row.code}: ${row.convertedAmount} (rate ${row.rate})`;
    container.append(item);
  }
}

function renderMetalConversion(container, conversion, context) {
  container.innerHTML = "";
  if (!conversion) {
    return;
  }

  const operation = conversion.operation || context.operation || "metal-to-currency";
  const unit = conversion.unit || context.unit || "oz";
  const unitPricePerOunce = Number(conversion.unitPricePerOunce || conversion.unitPrice || 0);
  const unitPricePerGram = Number(
    conversion.unitPricePerGram || (unitPricePerOunce / TROY_OUNCE_IN_GRAMS).toFixed(6) || 0
  );
  const selectedUnitPrice = unit === "g" ? unitPricePerGram : unitPricePerOunce;
  const inputAmount = Number(context.amount || conversion.inputAmount || 0);
  const metalAmount = Number(
    conversion.metalAmount !== undefined
      ? conversion.metalAmount
      : operation === "currency-to-metal"
        ? Number((inputAmount / selectedUnitPrice).toFixed(4))
        : inputAmount
  );
  const currencyAmount = Number(
    conversion.currencyAmount !== undefined
      ? conversion.currencyAmount
      : operation === "currency-to-metal"
        ? inputAmount
        : Number((inputAmount * selectedUnitPrice).toFixed(4))
  );

  const resultItem = document.createElement("li");
  resultItem.className = "conversion-list__primary";
  if (operation === "currency-to-metal") {
    resultItem.textContent = `${currencyAmount} ${conversion.currency} buys ${metalAmount} ${unit} of ${conversion.metalName} (${conversion.metalSymbol}).`;
  } else {
    resultItem.textContent = `${metalAmount} ${unit} of ${conversion.metalName} (${conversion.metalSymbol}) is worth ${currencyAmount} ${conversion.currency}.`;
  }

  const ounceItem = document.createElement("li");
  ounceItem.className = "conversion-list__meta";
  ounceItem.textContent = `${conversion.metalName} (${conversion.metalSymbol}) price per oz: ${unitPricePerOunce} ${conversion.currency}`;

  const gramItem = document.createElement("li");
  gramItem.className = "conversion-list__meta";
  gramItem.textContent = `${conversion.metalName} (${conversion.metalSymbol}) price per g: ${unitPricePerGram} ${conversion.currency}`;

  container.append(resultItem, ounceItem, gramItem);
}

function formatDateTime(value, fallbackText) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackText;
  }
  return parsed.toLocaleString();
}

function resolveCurrencyCode(value, currencies) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const codeFromFormatted = raw.split(" - ")[0].toUpperCase();
  const byCode = currencies.find((c) => c.code === codeFromFormatted);
  if (byCode) {
    return byCode.code;
  }

  const upper = raw.toUpperCase();
  const exactCode = currencies.find((c) => c.code === upper);
  if (exactCode) {
    return exactCode.code;
  }

  const lower = raw.toLowerCase();
  const exactName = currencies.find((c) => c.name.toLowerCase() === lower);
  if (exactName) {
    return exactName.code;
  }

  return "";
}

async function loadBootData() {
  const [currencyResponse, metalsResponse, translationResponse] = await Promise.all([
    fetch("/api/currencies"),
    fetch("/api/metals"),
    fetch("/i18n/translations.json")
  ]);

  if (!currencyResponse.ok || !metalsResponse.ok || !translationResponse.ok) {
    throw new Error("Could not load startup data.");
  }

  const currenciesPayload = await currencyResponse.json();
  const metalsPayload = await metalsResponse.json();
  const translationsPayload = await translationResponse.json();
  return { currenciesPayload, metalsPayload, translationsPayload };
}

function setupLanguageSelector(t) {
  const languageLabel = document.querySelector("#language-label");
  const flagButton = document.querySelector("#language-flag-button");
  const languageMenu = document.querySelector("#language-menu");
  const languageMenuItems = Array.from(
    document.querySelectorAll(".language-switcher__menu-item")
  );
  const lang = getSelectedLanguage();
  const meta = LANGUAGE_META[lang] || LANGUAGE_META[DEFAULT_LANGUAGE];

  languageLabel.textContent = t("languageLabel");
  flagButton.textContent = meta.flag;
  document.documentElement.lang = meta.htmlLang;

  const closeMenu = () => {
    languageMenu.hidden = true;
    flagButton.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    languageMenu.hidden = false;
    flagButton.setAttribute("aria-expanded", "true");
  };

  closeMenu();

  flagButton.addEventListener("click", () => {
    if (languageMenu.hidden) {
      openMenu();
      return;
    }
    closeMenu();
  });

  languageMenuItems.forEach((item) => {
    item.addEventListener("click", () => {
      const selected = item.dataset.lang;
      if (!SUPPORTED_LANGUAGES.includes(selected)) {
        return;
      }
      localStorage.setItem(LANG_STORAGE_KEY, selected);
      location.reload();
    });
  });

  document.addEventListener("click", (event) => {
    const clickedInsideSwitcher = event.target.closest(".language-switcher");
    if (!clickedInsideSwitcher) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
}

function applyNavigationText(t) {
  const currencyLink = document.querySelector("#nav-currency");
  const metalsLink = document.querySelector("#nav-metals");
  if (currencyLink) {
    currencyLink.textContent = t("navCurrency");
  }
  if (metalsLink) {
    metalsLink.textContent = t("navMetals");
  }
}

function applyPageText(t, pageType) {
  const titleKey = pageType === "metals" ? "metalsPageTitle" : "pageTitle";
  const subtitleKey = pageType === "metals" ? "metalsPageSubtitle" : "pageSubtitle";
  document.title = t(titleKey);
  document.querySelector("#page-title").textContent = t(titleKey);
  document.querySelector("#page-subtitle").textContent = t(subtitleKey);
}

function initCurrencyForm({ t, currencies, maxComparisons }) {
  const form = document.querySelector("#converter-form");
  const submitResult = document.querySelector("#submit-result");
  const conversionList = document.querySelector("#conversion-list");
  const grid = document.createElement("div");
  grid.className = "form-grid";

  const amountField = makeField({
    id: "amount",
    label: t("amountLabel"),
    type: "number",
    placeholder: t("amountPlaceholder")
  });
  amountField.input.min = "0";
  amountField.input.step = "0.01";
  amountField.input.required = true;

  const baseField = makeSelectField({
    id: "baseCurrency",
    label: t("baseCurrencyLabel")
  });
  fillCurrencyOptions(baseField.select, currencies);
  baseField.select.value = "USD";

  const targetSection = document.createElement("div");
  targetSection.className = "field field--full target-section";

  const targetSectionTitle = document.createElement("div");
  targetSectionTitle.className = "target-section__title";
  targetSectionTitle.textContent = t("targetSectionTitle", { max: maxComparisons });

  const targetContainer = document.createElement("div");
  targetContainer.className = "target-container";

  const targetBlocks = [];

  const getTargetLabel = (idx) => t("targetBlockLabel", { index: idx + 1 });
  const getRemoveAriaLabel = (idx) => t("removeBlockAria", { index: idx + 1 });

  const refreshCurrencyLists = () => {
    const baseCode = baseField.select.value;
    const selectedCodes = targetBlocks
      .map((block) => block.getCode(resolveCurrencyCode))
      .filter(Boolean);

    for (const block of targetBlocks) {
      const ownCode = block.getCode(resolveCurrencyCode);
      const usedByOthers = new Set(selectedCodes.filter((code) => code !== ownCode));
      const allowedCurrencies = currencies.filter((currency) => {
        if (currency.code === baseCode && currency.code !== ownCode) {
          return false;
        }
        if (usedByOthers.has(currency.code) && currency.code !== ownCode) {
          return false;
        }
        return true;
      });
      block.setCurrencyOptions(allowedCurrencies);
    }
  };

  const onTargetSelectionChange = (changedBlock) => {
    const selectedCode = changedBlock.getCode(resolveCurrencyCode);
    if (!selectedCode) {
      refreshCurrencyLists();
      return;
    }

    if (selectedCode === baseField.select.value) {
      changedBlock.clear();
      submitResult.textContent = t("messageSameAsBase");
      refreshCurrencyLists();
      return;
    }

    const selectedByAnotherBlock = hasDuplicateSelectedCode(
      targetBlocks,
      changedBlock,
      resolveCurrencyCode
    );
    if (selectedByAnotherBlock) {
      changedBlock.clear();
      submitResult.textContent = t("messageDuplicateTarget");
      refreshCurrencyLists();
      return;
    }

    submitResult.textContent = "";
    refreshCurrencyLists();
  };

  const removeBlock = (wrapper) => {
    const idx = targetBlocks.findIndex((block) => block.wrapper === wrapper);
    if (idx !== -1) {
      targetBlocks.splice(idx, 1);
      wrapper.remove();
      refreshTargetBlockLabels(targetBlocks);
      refreshCurrencyLists();
      addButton.disabled = targetBlocks.length >= maxComparisons;
    }
  };

  const addBlock = () => {
    if (targetBlocks.length >= maxComparisons) {
      submitResult.textContent = t("messageMaxComparisons", { max: maxComparisons });
      return;
    }
    const block = createTargetBlock({
      index: targetBlocks.length,
      currencies,
      allowRemove: targetBlocks.length > 0,
      onRemove: removeBlock,
      onSelectionChange: () => onTargetSelectionChange(block),
      getTargetLabel,
      getRemoveAriaLabel,
      inputPlaceholder: t("targetBlockPlaceholder")
    });
    targetBlocks.push(block);
    targetContainer.append(block.wrapper);
    refreshCurrencyLists();
    addButton.disabled = targetBlocks.length >= maxComparisons;
    submitResult.textContent = "";
  };

  const addRow = document.createElement("div");
  addRow.className = "target-section__add-row";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "target-section__add-btn";
  addButton.setAttribute("aria-label", "Add currency block");
  addButton.textContent = "+";
  addButton.addEventListener("click", addBlock);
  addRow.append(addButton);

  baseField.select.addEventListener("change", () => {
    for (const block of targetBlocks) {
      if (block.getCode(resolveCurrencyCode) === baseField.select.value) {
        block.clear();
      }
    }
    refreshCurrencyLists();
  });

  const hint = document.createElement("div");
  hint.className = "hint field--full";
  hint.textContent = t("hintText");

  const actionRow = document.createElement("div");
  actionRow.className = "action-row field--full";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = t("convertButton");
  actionRow.append(button);

  targetSection.append(targetSectionTitle, targetContainer, addRow);
  addBlock();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    conversionList.innerHTML = "";

    const unresolvedEntries = hasUnresolvedTargetEntries(
      targetBlocks,
      resolveCurrencyCode
    );
    if (unresolvedEntries) {
      submitResult.textContent = t("messageInvalidTarget");
      return;
    }

    const targetCurrencies = targetBlocks
      .map((block) => block.getCode(resolveCurrencyCode))
      .filter(Boolean);
    const validation = validateResolvedTargets({
      targetCurrencies,
      baseCurrency: baseField.select.value,
      maxComparisons
    });
    if (!validation.ok) {
      submitResult.textContent = t(validation.errorKey, { max: maxComparisons });
      return;
    }

    const payload = {
      amount: amountField.input.value,
      baseCurrency: baseField.select.value,
      targetCurrencies: validation.uniqueTargets
    };

    try {
      const response = await fetch("/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        submitResult.textContent = data.message || t("messageSubmitError");
        return;
      }

      if (data.cached) {
        submitResult.textContent = t("cachedResultMessage", {
          dateTime: formatDateTime(data.fetchedAt, t("unknownDate")),
          cacheDate: data.cacheDate
        });
      } else {
        submitResult.textContent = t("freshResultMessage", {
          site: data.sourceSite || t("defaultApiSite"),
          dateTime: formatDateTime(data.fetchedAt, t("unknownDate"))
        });
      }
      renderConversionList(conversionList, data.conversions || []);
    } catch {
      submitResult.textContent = t("messageSubmitError");
    }
  });

  grid.append(amountField.wrapper, baseField.wrapper, targetSection, hint, actionRow);
  form.append(grid);
}

function initMetalsForm({ t, currencies, metals }) {
  const form = document.querySelector("#converter-form");
  const submitResult = document.querySelector("#submit-result");
  const conversionList = document.querySelector("#conversion-list");
  let operation = "metal-to-currency";

  const reverseRow = document.createElement("div");
  reverseRow.className = "mode-toggle field--full";
  const reverseButton = document.createElement("button");
  reverseButton.type = "button";
  reverseButton.className = "mode-toggle__button";
  reverseButton.textContent = t("metalReverseButton");
  reverseRow.append(reverseButton);

  const grid = document.createElement("div");
  grid.className = "form-grid";

  const amountField = makeField({
    id: "metalAmount",
    label: t("metalAmountLabel"),
    type: "number",
    placeholder: t("amountPlaceholder")
  });
  amountField.input.min = "0";
  amountField.input.step = "0.01";
  amountField.input.required = true;
  setFieldCompact(amountField);

  const currencyField = makeSelectField({
    id: "metalCurrency",
    label: t("metalCurrencyLabel")
  });
  fillCurrencyOptions(currencyField.select, currencies);
  currencyField.select.value = "USD";
  currencyField.wrapper.classList.add("field--compact");

  const metalField = makeSelectField({
    id: "metalSymbol",
    label: t("metalLabel")
  });
  fillMetalOptions(metalField.select, metals);
  metalField.select.value = metals[0]?.symbol || "XAU";

  const unitField = makeSelectField({
    id: "metalUnit",
    label: t("metalUnitLabel")
  });
  unitField.select.innerHTML = "";
  for (const unit of [
    { value: "oz", label: t("metalUnitOunces") },
    { value: "g", label: t("metalUnitGrams") }
  ]) {
    const option = document.createElement("option");
    option.value = unit.value;
    option.textContent = unit.label;
    unitField.select.append(option);
  }
  unitField.select.value = "oz";
  unitField.wrapper.classList.add("field--compact");

  const hint = document.createElement("div");
  hint.className = "hint field--full";

  const actionRow = document.createElement("div");
  actionRow.className = "action-row field--full";
  const button = document.createElement("button");
  button.type = "submit";
  actionRow.append(button);

  const updateModeText = () => {
    const amountLabel = amountField.wrapper.querySelector("label");
    if (operation === "currency-to-metal") {
      amountLabel.textContent = t("metalSpendAmountLabel");
      hint.textContent = t("metalReverseHintText");
      button.textContent = t("metalReverseConvertButton");
      reverseButton.setAttribute("aria-label", t("metalReverseButtonAriaToForward"));
      return;
    }

    amountLabel.textContent = t("metalAmountLabel");
    hint.textContent = t("metalHintText");
    button.textContent = t("metalConvertButton");
    reverseButton.setAttribute("aria-label", t("metalReverseButtonAriaToReverse"));
  };

  reverseButton.addEventListener("click", () => {
    operation = operation === "metal-to-currency" ? "currency-to-metal" : "metal-to-currency";
    submitResult.textContent = "";
    conversionList.innerHTML = "";
    updateModeText();
  });

  updateModeText();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    conversionList.innerHTML = "";

    if (!metalField.select.value) {
      submitResult.textContent = t("messageNeedMetal");
      return;
    }
    if (!currencyField.select.value) {
      submitResult.textContent = t("messageNeedCurrency");
      return;
    }

    try {
      const response = await fetch("/convert-metals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountField.input.value,
          metalSymbol: metalField.select.value,
          currency: currencyField.select.value,
          unit: unitField.select.value,
          operation
        })
      });
      const data = await response.json();
      if (!response.ok) {
        submitResult.textContent = data.message || t("messageSubmitError");
        return;
      }

      if (data.cached) {
        submitResult.textContent = t("cachedResultMessage", {
          dateTime: formatDateTime(data.fetchedAt, t("unknownDate")),
          cacheDate: data.cacheDate
        });
      } else {
        submitResult.textContent = t("freshResultMessage", {
          site: data.sourceSite || t("defaultApiSite"),
          dateTime: formatDateTime(data.fetchedAt, t("unknownDate"))
        });
      }
      renderMetalConversion(conversionList, data.conversion, {
        operation,
        unit: unitField.select.value,
        amount: Number(amountField.input.value || 0)
      });
    } catch {
      submitResult.textContent = t("messageSubmitError");
    }
  });

  grid.append(
    currencyField.wrapper,
    amountField.wrapper,
    unitField.wrapper,
    metalField.wrapper,
    hint,
    actionRow
  );
  form.append(reverseRow, grid);
}

async function initApp() {
  const form = document.querySelector("#converter-form");
  const submitResult = document.querySelector("#submit-result");
  const pageType = document.body.dataset.page || "currency";

  let currencies = [];
  let metals = [];
  let maxComparisons = DEFAULT_MAX_COMPARISONS;
  let t = (key) => key;

  try {
    const { currenciesPayload, metalsPayload, translationsPayload } = await loadBootData();
    const lang = getSelectedLanguage();
    const dictionary =
      translationsPayload[lang] || translationsPayload[DEFAULT_LANGUAGE] || {};
    t = makeTranslator(dictionary);
    setupLanguageSelector(t);
    applyNavigationText(t);
    applyPageText(t, pageType);

    currencies = Array.isArray(currenciesPayload.currencies)
      ? currenciesPayload.currencies
      : [];
    metals = Array.isArray(metalsPayload.metals) ? metalsPayload.metals : [];
    maxComparisons =
      Number(currenciesPayload.maxComparisons) || DEFAULT_MAX_COMPARISONS;
  } catch {
    submitResult.textContent = "Unable to load startup data.";
    return;
  }

  form.innerHTML = "";
  if (pageType === "metals") {
    initMetalsForm({ t, currencies, metals });
    return;
  }

  initCurrencyForm({ t, currencies, maxComparisons });
}

initApp();
