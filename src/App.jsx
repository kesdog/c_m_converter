import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Combobox,
  Container,
  Field,
  Flex,
  Heading,
  HStack,
  Input,
  Menu,
  NativeSelect,
  Portal,
  Separator,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  createListCollection,
} from "@chakra-ui/react";
import { DE, ES, FR, GB } from "country-flag-icons/react/3x2";
import { validateResolvedTargets } from "../validation/clientValidation.js";

const DEFAULT_MAX_COMPARISONS = 4;
const LANG_STORAGE_KEY = "app_lang";
const THEME_STORAGE_KEY = "app_theme";
const LANGUAGE_META = {
  en: { Flag: GB, htmlLang: "en-GB", label: "English" },
  fr: { Flag: FR, htmlLang: "fr-FR", label: "Francais" },
  de: { Flag: DE, htmlLang: "de-DE", label: "Deutsch" },
  es: { Flag: ES, htmlLang: "es-ES", label: "Espanol" },
};
const TROY_OUNCE_IN_GRAMS = 31.1034768;
const currencyLabel = (currency) => `${currency.code} - ${currency.name}`;
const translate = (template, variables = {}) =>
  String(template || "").replace(/\{(\w+)\}/g, (_, key) =>
    variables[key] === undefined ? `{${key}}` : String(variables[key]),
  );
const formatDateTime = (value, fallback) =>
  Number.isNaN(new Date(value).getTime())
    ? fallback
    : new Date(value).toLocaleString();

function StatusMessage({ message, error = false }) {
  if (!message) return null;
  return (
    <Box
      aria-live="polite"
      borderLeftWidth="2px"
      borderColor={error ? "var(--danger)" : "var(--accent)"}
      bg={error ? "var(--danger-bg)" : "var(--status-bg)"}
      color={error ? "var(--danger)" : "var(--status-ink)"}
      px="3"
      py="2"
      borderRadius="md"
      fontSize="sm"
    >
      {message}
    </Box>
  );
}

function CurrencyCombobox({
  id,
  label,
  currencies,
  selectedCode,
  onSelect,
  onRawChange,
  placeholder,
}) {
  const [inputValue, setInputValue] = useState("");
  const selected = currencies.find(
    (currency) => currency.code === selectedCode,
  );
  const items = currencies
    .map((currency) => ({
      value: currency.code,
      label: currencyLabel(currency),
    }))
    .filter((item) =>
      item.label.toLowerCase().includes(inputValue.toLowerCase()),
    );
  const collection = createListCollection({ items });
  useEffect(() => {
    setInputValue(selected ? currencyLabel(selected) : "");
  }, [selectedCode]);
  return (
    <Combobox.Root
      id={id}
      collection={collection}
      value={selectedCode ? [selectedCode] : []}
      inputValue={inputValue}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ sameWidth: true, placement: "bottom-start", flip: true }}
      onValueChange={(details) => {
        const code = details.value[0] || "";
        const currency = currencies.find((item) => item.code === code);
        const label = currency ? currencyLabel(currency) : "";
        setInputValue(label);
        onRawChange(label);
        onSelect(code);
      }}
      onInputValueChange={(details) => {
        setInputValue(details.inputValue);
        onRawChange(details.inputValue);
      }}
    >
      <Combobox.Control>
        <Combobox.Input
          aria-label={label}
          placeholder={placeholder}
          bg="var(--field)"
          borderColor="var(--border)"
          color="var(--ink)"
          _placeholder={{ color: "var(--placeholder)" }}
          _focusVisible={{
            borderColor: "var(--focus)",
            boxShadow: "0 0 0 1px var(--focus)",
          }}
        />
        <Combobox.IndicatorGroup color="var(--accent)" />
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner maxW="calc(100vw - 2rem)" zIndex="dropdown">
          <Combobox.Content
            maxH="min(42vh, 19rem)"
            overflowY="auto"
            bg="var(--surface-raised)"
            borderColor="var(--border)"
            color="var(--ink)"
          >
            {collection.items.length ? (
              collection.items.map((item) => (
                <Combobox.Item
                  key={item.value}
                  item={item}
                  _highlighted={{ bg: "var(--nav-active)" }}
                >
                  <Combobox.ItemText>{item.label}</Combobox.ItemText>
                  <Combobox.ItemIndicator color="var(--accent)" />
                </Combobox.Item>
              ))
            ) : (
              <Combobox.Empty px="3" py="2" color="var(--muted)">
                No available currencies match this search.
              </Combobox.Empty>
            )}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

function Results({ conversions, conversion, context }) {
  if (conversion) {
    const ounce = Number(
      conversion.unitPricePerOunce || conversion.unitPrice || 0,
    );
    const gram = Number(
      conversion.unitPricePerGram || (ounce / TROY_OUNCE_IN_GRAMS).toFixed(6),
    );
    const main =
      context.operation === "currency-to-metal"
        ? `${context.amount} ${conversion.currency} buys ${conversion.outputAmount} ${context.unit} of ${conversion.metalName} (${conversion.metalSymbol})`
        : `${conversion.outputAmount} ${conversion.currency} for ${context.amount} ${context.unit} of ${conversion.metalName} (${conversion.metalSymbol})`;
    return (
      <Stack gap="3" mt="5">
        <Text
          fontFamily="Georgia, serif"
          fontSize={{ base: "xl", md: "2xl" }}
          color="var(--result)"
        >
          {main}
        </Text>
        <HStack gap="2" flexWrap="wrap">
          <Badge variant="subtle" colorPalette="teal">
            {context.unit === "g" ? gram : ounce} {conversion.currency} /{" "}
            {context.unit}
          </Badge>
          <Badge variant="outline" colorPalette="gray">
            {ounce} / oz
          </Badge>
          <Badge variant="outline" colorPalette="gray">
            {gram} / g
          </Badge>
        </HStack>
      </Stack>
    );
  }
  if (!conversions?.length) return null;
  return (
    <Stack gap="2" mt="5">
      {conversions.map((item) => (
        <Flex
          key={item.code}
          align="baseline"
          justify="space-between"
          gap="4"
          py="3"
          borderBottomWidth="1px"
          borderColor="var(--border)"
        >
          <Text
            color="var(--muted)"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {item.code}
          </Text>
          <Stack gap="0" textAlign="right">
            <Text
              fontSize={{ base: "xl", md: "2xl" }}
              fontWeight="700"
              color="var(--ink)"
            >
              {item.convertedAmount}
            </Text>
            <Text color="var(--muted)" fontSize="xs">
              rate {item.rate}
            </Text>
          </Stack>
        </Flex>
      ))}
    </Stack>
  );
}

function CurrencyForm({ t, currencies, maxComparisons }) {
  const [amount, setAmount] = useState("");
  const [base, setBase] = useState("USD");
  const [targets, setTargets] = useState([""]);
  const [rawTargets, setRawTargets] = useState([""]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [conversions, setConversions] = useState([]);
  const [loading, setLoading] = useState(false);
  const setTarget = (index, value) => {
    setTargets((current) =>
      current.map((target, targetIndex) =>
        targetIndex === index ? value : target,
      ),
    );
    setMessage("");
  };
  const setRaw = (index, value) =>
    setRawTargets((current) =>
      current.map((target, targetIndex) =>
        targetIndex === index ? value : target,
      ),
    );
  const changeBase = (event) => {
    const next = event.target.value;
    setBase(next);
    setTargets((current) =>
      current.map((target) => (target === next ? "" : target)),
    );
    setRawTargets((current) =>
      current.map((raw, index) => (targets[index] === next ? "" : raw)),
    );
  };
  const submit = async (event) => {
    event.preventDefault();
    setConversions([]);
    const invalid = rawTargets.some(
      (raw, index) =>
        raw &&
        raw !==
          currencyLabel(
            currencies.find((currency) => currency.code === targets[index]) || {
              code: "",
              name: "",
            },
          ),
    );
    if (invalid) {
      setMessage(t("messageInvalidTarget"));
      setError(true);
      return;
    }
    const validation = validateResolvedTargets({
      targetCurrencies: targets.filter(Boolean),
      baseCurrency: base,
      maxComparisons,
    });
    if (!validation.ok) {
      setMessage(t(validation.errorKey, { max: maxComparisons }));
      setError(true);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          baseCurrency: base,
          targetCurrencies: validation.uniqueTargets,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || t("messageSubmitError"));
      setMessage(
        data.cached
          ? t("cachedResultMessage", {
              dateTime: formatDateTime(data.fetchedAt, t("unknownDate")),
              cacheDate: data.cacheDate,
            })
          : t("freshResultMessage", {
              site: data.sourceSite || t("defaultApiSite"),
              dateTime: formatDateTime(data.fetchedAt, t("unknownDate")),
            }),
      );
      setError(false);
      setConversions(data.conversions || []);
    } catch (requestError) {
      setMessage(requestError.message || t("messageSubmitError"));
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Stack as="form" onSubmit={submit} gap="6">
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="5">
        <Field.Root required>
          <Field.Label>{t("amountLabel")}</Field.Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t("amountPlaceholder")}
            bg="var(--field)"
            borderColor="var(--border)"
            color="var(--ink)"
            required
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>{t("baseCurrencyLabel")}</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={base}
              onChange={changeBase}
              bg="var(--field)"
              borderColor="var(--border)"
              color="var(--ink)"
            >
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currencyLabel(currency)}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator color="var(--accent)" />
          </NativeSelect.Root>
        </Field.Root>
      </SimpleGrid>
      <Stack gap="3">
        <Flex justify="space-between" align="center" gap="4">
          <Text fontWeight="600">
            {t("targetSectionTitle", { max: maxComparisons })}
          </Text>
          <Badge colorPalette="teal" variant="subtle">
            {targets.filter(Boolean).length} / {maxComparisons}
          </Badge>
        </Flex>
        {targets.map((target, index) => {
          const excluded = new Set([
            base,
            ...targets.filter(
              (code, targetIndex) => targetIndex !== index && code,
            ),
          ]);
          const available = currencies.filter(
            (currency) =>
              !excluded.has(currency.code) || currency.code === target,
          );
          const targetLabel = t("targetBlockLabel", { index: index + 1 });
          return (
            <Box
              key={index}
              borderWidth="1px"
              borderColor="var(--border)"
              borderRadius="lg"
              bg="var(--surface-raised)"
              p={{ base: "3", md: "4" }}
            >
              <Flex align="center" justify="space-between" mb="2" gap="3">
                <Text fontWeight="500">{targetLabel}</Text>
                {index > 0 && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    onClick={() => {
                      setTargets((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      );
                      setRawTargets((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      );
                    }}
                    aria-label={t("removeBlockAria", { index: index + 1 })}
                  >
                    Remove
                  </Button>
                )}
              </Flex>
              <CurrencyCombobox
                id={`target-currency-${index}`}
                label={targetLabel}
                currencies={available}
                selectedCode={target}
                onSelect={(code) => setTarget(index, code)}
                onRawChange={(value) => setRaw(index, value)}
                placeholder={t("targetBlockPlaceholder")}
              />
            </Box>
          );
        })}
        <Flex justify="center">
          <Button
            type="button"
            size="sm"
            w="10"
            h="10"
            p="0"
            fontSize="xl"
            variant="outline"
            borderColor="var(--border)"
            bg="var(--surface-raised)"
            color="var(--ink)"
            _hover={{ bg: "var(--nav-active)" }}
            onClick={() => {
              setTargets((current) => [...current, ""]);
              setRawTargets((current) => [...current, ""]);
            }}
            disabled={targets.length >= maxComparisons}
            aria-label="Add currency comparison"
          >
            +
          </Button>
        </Flex>
        <Text color="var(--hint)" fontSize="sm">
          {t("hintText")}
        </Text>
      </Stack>
      <Button
        type="submit"
        loading={loading}
        loadingText="Converting"
        size="lg"
        bg="var(--accent)"
        color="var(--accent-ink)"
        _hover={{ bg: "var(--accent-hover)" }}
      >
        {t("convertButton")}
      </Button>
      <StatusMessage message={message} error={error} />
      <Results conversions={conversions} />
    </Stack>
  );
}

function SelectField({ label, value, onChange, children }) {
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={value}
          onChange={onChange}
          bg="var(--field)"
          borderColor="var(--border)"
          color="var(--ink)"
        >
          {children}
        </NativeSelect.Field>
        <NativeSelect.Indicator color="var(--accent)" />
      </NativeSelect.Root>
    </Field.Root>
  );
}

function MetalsForm({ t, currencies, metals }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [metal, setMetal] = useState("XAU");
  const [unit, setUnit] = useState("oz");
  const [operation, setOperation] = useState("metal-to-currency");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [conversion, setConversion] = useState(null);
  const [loading, setLoading] = useState(false);
  const reverse = operation === "currency-to-metal";
  const submit = async (event) => {
    event.preventDefault();
    setConversion(null);
    setLoading(true);
    try {
      const response = await fetch("/convert-metals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          metalSymbol: metal,
          currency,
          unit,
          operation,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || t("messageSubmitError"));
      setMessage(
        data.cached
          ? t("cachedResultMessage", {
              dateTime: formatDateTime(data.fetchedAt, t("unknownDate")),
              cacheDate: data.cacheDate,
            })
          : t("freshResultMessage", {
              site: data.sourceSite || t("defaultApiSite"),
              dateTime: formatDateTime(data.fetchedAt, t("unknownDate")),
            }),
      );
      setError(false);
      setConversion(data.conversion);
    } catch (requestError) {
      setMessage(requestError.message || t("messageSubmitError"));
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Stack as="form" onSubmit={submit} gap="6">
      <Flex
        justify="space-between"
        align="center"
        borderWidth="1px"
        borderColor="var(--border)"
        borderRadius="lg"
        p="3"
        bg="var(--surface-raised)"
        gap="4"
      >
        <Stack gap="0">
          <Text fontWeight="600">
            {reverse ? t("metalSpendAmountLabel") : t("metalAmountLabel")}
          </Text>
          <Text fontSize="sm" color="var(--hint)">
            {reverse ? t("metalReverseHintText") : t("metalHintText")}
          </Text>
        </Stack>
        <Button
          type="button"
          size="sm"
          w="10"
          h="10"
          p="0"
          fontSize="xl"
          variant="outline"
          bg="var(--surface)"
          borderColor="var(--border)"
          color="var(--ink)"
          _hover={{ bg: "var(--nav-active)" }}
          onClick={() => {
            setOperation(reverse ? "metal-to-currency" : "currency-to-metal");
            setConversion(null);
            setMessage("");
          }}
          aria-label={
            reverse
              ? t("metalReverseButtonAriaToForward")
              : t("metalReverseButtonAriaToReverse")
          }
        >
          {t("metalReverseButton")}
        </Button>
      </Flex>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="5">
        <Field.Root required>
          <Field.Label>
            {reverse ? t("metalSpendAmountLabel") : t("metalAmountLabel")}
          </Field.Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t("amountPlaceholder")}
            bg="var(--field)"
            borderColor="var(--border)"
            color="var(--ink)"
            required
          />
        </Field.Root>
        <SelectField
          label={t("metalCurrencyLabel")}
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
        >
          {currencies.map((item) => (
            <option key={item.code} value={item.code}>
              {currencyLabel(item)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("metalLabel")}
          value={metal}
          onChange={(event) => setMetal(event.target.value)}
        >
          {metals.map((item) => (
            <option key={item.symbol} value={item.symbol}>
              {item.name} ({item.symbol})
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("metalUnitLabel")}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        >
          <option value="oz">{t("metalUnitOunces")}</option>
          <option value="g">{t("metalUnitGrams")}</option>
        </SelectField>
      </SimpleGrid>
      <Button
        type="submit"
        loading={loading}
        loadingText="Calculating"
        size="lg"
        bg="var(--accent)"
        color="var(--accent-ink)"
        _hover={{ bg: "var(--accent-hover)" }}
      >
        {reverse ? t("metalReverseConvertButton") : t("metalConvertButton")}
      </Button>
      <StatusMessage message={message} error={error} />
      <Results conversion={conversion} context={{ operation, unit, amount }} />
    </Stack>
  );
}

export default function App({ pageType }) {
  const [boot, setBoot] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [language, setLanguage] = useState(() =>
    LANGUAGE_META[localStorage.getItem(LANG_STORAGE_KEY)]
      ? localStorage.getItem(LANG_STORAGE_KEY)
      : "en",
  );
  const [theme, setTheme] = useState(() =>
    localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark",
  );
  useEffect(() => {
    Promise.all([
      fetch("/api/currencies"),
      fetch("/api/metals"),
      fetch("/i18n/translations.json"),
    ])
      .then(
        async ([currencyResponse, metalsResponse, translationsResponse]) => {
          if (
            !currencyResponse.ok ||
            !metalsResponse.ok ||
            !translationsResponse.ok
          )
            throw new Error("Unable to load startup data.");
          setBoot({
            currencies: await currencyResponse.json(),
            metals: await metalsResponse.json(),
            translations: await translationsResponse.json(),
          });
        },
      )
      .catch((error) => setLoadError(error.message));
  }, []);
  const t = (key, variables) =>
    translate(
      (boot?.translations?.[language] || boot?.translations?.en || {})[key] ||
        key,
      variables,
    );
  const isMetals = pageType === "metals";
  const ActiveFlag = LANGUAGE_META[language].Flag;
  const title = isMetals ? t("metalsPageTitle") : t("pageTitle");
  const subtitle = isMetals ? t("metalsPageSubtitle") : t("pageSubtitle");
  useEffect(() => {
    document.title = title;
    document.documentElement.lang = LANGUAGE_META[language].htmlLang;
  }, [title, language]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
  return (
    <Box className="app-shell" data-theme={theme} py={{ base: "4", md: "10" }}>
      <Container maxW="3xl" px={{ base: "4", md: "6" }}>
        <Card.Root
          className="converter-card"
          bg="var(--surface)"
          borderWidth="1px"
          borderColor="var(--border)"
          boxShadow="0 28px 80px var(--shadow)"
        >
          <Card.Body p={{ base: "5", sm: "7", md: "9" }}>
            <Flex
              justify="space-between"
              align="center"
              gap="4"
              mb={{ base: "8", md: "10" }}
              wrap="wrap"
            >
              <HStack
                gap="1"
                bg="var(--surface-raised)"
                borderWidth="1px"
                borderColor="var(--border)"
                borderRadius="full"
                p="1"
              >
                <Button
                  as="a"
                  href="/currency"
                  size="sm"
                  borderRadius="full"
                  variant={isMetals ? "ghost" : "solid"}
                  bg={isMetals ? "transparent" : "var(--nav-active)"}
                  color="var(--ink)"
                >
                  {t("navCurrency")}
                </Button>
                <Button
                  as="a"
                  href="/metals"
                  size="sm"
                  borderRadius="full"
                  variant={isMetals ? "solid" : "ghost"}
                  bg={isMetals ? "var(--nav-active)" : "transparent"}
                  color="var(--ink)"
                >
                  {t("navMetals")}
                </Button>
              </HStack>
              <HStack gap="2">
                <Switch.Root
                  className="theme-switch"
                  size="sm"
                  colorPalette="teal"
                  checked={theme === "dark"}
                  onCheckedChange={({ checked }) =>
                    setTheme(checked ? "dark" : "light")
                  }
                >
                  <Switch.HiddenInput aria-label="Dark theme" />
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Label>
                    {theme === "dark" ? "Dark" : "Light"}
                  </Switch.Label>
                </Switch.Root>
                <Menu.Root positioning={{ placement: "bottom-end" }}>
                  <Menu.Trigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      borderColor="var(--border)"
                      color="var(--ink)"
                    >
                      <Box as="span" className="language-flag">
                        <ActiveFlag title={LANGUAGE_META[language].label} />
                      </Box>{" "}
                      <Box as="span" display={{ base: "none", sm: "inline" }}>
                        {t("languageLabel")}
                      </Box>
                    </Button>
                  </Menu.Trigger>
                  <Portal>
                    <Menu.Positioner>
                      <Menu.Content
                        bg="var(--surface-raised)"
                        borderColor="var(--border)"
                        color="var(--ink)"
                      >
                        {Object.entries(LANGUAGE_META).map(([code, meta]) => {
                          const Flag = meta.Flag;
                          return (
                            <Menu.Item
                              key={code}
                              value={code}
                              onClick={() => {
                                localStorage.setItem(LANG_STORAGE_KEY, code);
                                setLanguage(code);
                              }}
                              bg={
                                code === language
                                  ? "var(--nav-active)"
                                  : "transparent"
                              }
                              color="var(--ink)"
                              _highlighted={{
                                bg: "var(--nav-active)",
                                color: "var(--ink)",
                              }}
                            >
                              <Box as="span" className="language-flag">
                                <Flag title={meta.label} />
                              </Box>{" "}
                              {meta.label}
                            </Menu.Item>
                          );
                        })}
                      </Menu.Content>
                    </Menu.Positioner>
                  </Portal>
                </Menu.Root>
              </HStack>
            </Flex>
            <Stack gap="3" mb="8">
              <Text
                textStyle="xs"
                color="var(--accent)"
                textTransform="uppercase"
                letterSpacing="0.16em"
              >
                Live market tools
              </Text>
              <Heading
                as="h1"
                fontFamily="Georgia, serif"
                fontSize={{ base: "3xl", md: "5xl" }}
                fontWeight="500"
                color="var(--ink)"
              >
                {title}
              </Heading>
              <Text color="var(--muted)" maxW="xl">
                {subtitle}
              </Text>
            </Stack>
            <Separator borderColor="var(--border)" mb="8" />
            {loadError ? (
              <StatusMessage message={loadError} error />
            ) : !boot ? (
              <Text color="var(--muted)">Loading market tools...</Text>
            ) : isMetals ? (
              <MetalsForm
                t={t}
                currencies={boot.currencies.currencies || []}
                metals={boot.metals.metals || []}
              />
            ) : (
              <CurrencyForm
                t={t}
                currencies={boot.currencies.currencies || []}
                maxComparisons={
                  Number(boot.currencies.maxComparisons) ||
                  DEFAULT_MAX_COMPARISONS
                }
              />
            )}
          </Card.Body>
        </Card.Root>
      </Container>
    </Box>
  );
}
