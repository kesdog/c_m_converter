export function createTargetBlock({
  index,
  currencies,
  allowRemove,
  onRemove,
  onSelectionChange,
  getTargetLabel,
  getRemoveAriaLabel,
  inputPlaceholder
}) {
  const wrapper = document.createElement("div");
  wrapper.className = "target-block";

  const topBar = document.createElement("div");
  topBar.className = "target-block__top";

  const label = document.createElement("label");
  label.className = "target-block__label";
  label.htmlFor = `target-currency-${index}`;
  label.textContent = getTargetLabel(index);
  topBar.append(label);

  let removeButton = null;
  if (allowRemove) {
    removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "target-block__remove";
    removeButton.setAttribute("aria-label", getRemoveAriaLabel(index));
    removeButton.textContent = "X";
    removeButton.addEventListener("click", () => onRemove(wrapper));
    topBar.append(removeButton);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.id = `target-currency-${index}`;
  input.className = "target-block__input";
  input.placeholder = inputPlaceholder;

  const datalist = document.createElement("datalist");
  datalist.id = `currency-options-${index}`;
  for (const currency of currencies) {
    const option = document.createElement("option");
    option.value = `${currency.code} - ${currency.name}`;
    datalist.append(option);
  }
  input.setAttribute("list", datalist.id);
  input.addEventListener("change", onSelectionChange);
  input.addEventListener("blur", onSelectionChange);

  wrapper.append(topBar, input, datalist);

  return {
    wrapper,
    input,
    getCode: (resolveCurrencyCode) => resolveCurrencyCode(input.value, currencies),
    getRawValue: () => input.value.trim(),
    clear: () => {
      input.value = "";
    },
    setLabel: (idx) => {
      label.textContent = getTargetLabel(idx);
      if (removeButton) {
        removeButton.setAttribute("aria-label", getRemoveAriaLabel(idx));
      }
    },
    setCurrencyOptions: (list) => {
      datalist.innerHTML = "";
      for (const currency of list) {
        const option = document.createElement("option");
        option.value = `${currency.code} - ${currency.name}`;
        datalist.append(option);
      }
    }
  };
}

export function refreshTargetBlockLabels(blocks) {
  blocks.forEach((block, idx) => {
    block.setLabel(idx);
  });
}
