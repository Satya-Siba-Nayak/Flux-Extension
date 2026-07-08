// Content script for Flux Currency Converter

let exchangeRate = 84.0;
let baseCurrency = "usd";
let targetCurrency = "inr";
let isEnabled = true;
let showBadge = true;
let disabledDomains = [];
let processedNodes = new WeakSet();

// ── Currency Data ────────────────────────────────────────────────

// Magnitude words and abbreviations mapped to their multiplier values.
// Used to handle inputs like "$4 million" or "€2.5bn".
const MAGNITUDE_WORDS = {
  hundred:       100,
  thousand:      1_000,
  lakh:          100_000,
  lakhs:         100_000,
  million:       1_000_000,
  crore:         10_000_000,
  crores:        10_000_000,
  billion:       1_000_000_000,
  trillion:      1_000_000_000_000,
  // Common abbreviations
  k:             1_000,
  m:             1_000_000,
  mn:            1_000_000,
  b:             1_000_000_000,
  bn:            1_000_000_000,
  t:             1_000_000_000_000,
  tn:            1_000_000_000_000,
  cr:            10_000_000,
  l:             100_000,
};

// Build the magnitude suffix pattern dynamically from MAGNITUDE_WORDS keys.
// Longer keys first so e.g. "billion" matches before "b", "mn" before "m".
const MAGNITUDE_KEYS_PATTERN = Object.keys(MAGNITUDE_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const MAGNITUDE_SUFFIX = `(?:\\s*(${MAGNITUDE_KEYS_PATTERN})\\b)?`;

// Regex patterns defined as strings to create fresh instances each time.
// This avoids shared lastIndex state issues with global regex objects.
// Each regex now includes an optional second capture group for magnitude words.
const CURRENCIES = {
  usd: { symbol: "$", locale: "en-US", code: "USD", regexSource: `(?<![CAS])\\$([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  eur: { symbol: "€", locale: "de-DE", code: "EUR", regexSource: `€\\s?([\\d.]+,?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  gbp: { symbol: "£", locale: "en-GB", code: "GBP", regexSource: `£([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  inr: { symbol: "₹", locale: "en-IN", code: "INR", regexSource: `₹\\s?([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  jpy: { symbol: "¥", locale: "ja-JP", code: "JPY", regexSource: `¥([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  cad: { symbol: "C$", locale: "en-CA", code: "CAD", regexSource: `(?:C\\$|CAD\\s)([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  aud: { symbol: "A$", locale: "en-AU", code: "AUD", regexSource: `(?:A\\$|AUD\\s)([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  chf: { symbol: "CHF", locale: "de-CH", code: "CHF", regexSource: `CHF\\s?([\\d']+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  cny: { symbol: "CN¥", locale: "zh-CN", code: "CNY", regexSource: `(?:CN¥|RMB)\\s?([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  sgd: { symbol: "S$", locale: "en-SG", code: "SGD", regexSource: `(?:S\\$|SGD\\s)([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" }
};

/**
 * Creates a fresh regex instance for the given currency.
 * This prevents shared lastIndex state bugs from global regex reuse.
 */
function createCurrencyRegex(currencyCode) {
  const cur = CURRENCIES[currencyCode];
  if (!cur) return null;
  return new RegExp(cur.regexSource, cur.regexFlags);
}

// ── Domain Utilities ──────────────────────────────────────────────

function getRootDomain(hostname) {
  // Return IPv4 addresses as-is to avoid mangling them (EDGE-001)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const ccSLDs = ["co", "com", "org", "net", "gov", "edu", "ac"];
  if (ccSLDs.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function isDomainDisabled() {
  const root = getRootDomain(window.location.hostname);
  return disabledDomains.some(
    (d) => d === root || d === window.location.hostname,
  );
}

// ── Formatting ────────────────────────────────────────────────────

function formatCurrency(amount, currencyCode) {
  const cur = CURRENCIES[currencyCode];
  if (!cur) return `${amount.toFixed(2)}`;

  const formatter = new Intl.NumberFormat(cur.locale, {
    style: 'currency',
    currency: cur.code,
    minimumFractionDigits: (cur.code === 'JPY') ? 0 : 2,
    maximumFractionDigits: (cur.code === 'JPY') ? 0 : 2
  });

  return formatter.format(amount);
}

function parseCurrency(amountStr, currencyCode) {
  const cur = CURRENCIES[currencyCode];
  if (!cur) return parseFloat(amountStr);

  let cleanStr = amountStr;
  if (cur.locale === "de-DE") {
    // European format: 1.234,56
    cleanStr = cleanStr.replace(/\./g, "").replace(/,/g, ".");
  } else if (cur.locale === "de-CH") {
    // Swiss format: 1'234.56
    cleanStr = cleanStr.replace(/'/g, "");
  } else {
    // US/UK format: 1,234.56
    cleanStr = cleanStr.replace(/,/g, "");
  }
  
  return parseFloat(cleanStr);
}

// ── Badge Helper ──────────────────────────────────────────────────

function createBadge(originalText) {
  const badge = document.createElement("sup");
  badge.className = "flux-converted-badge";
  badge.textContent = "≈";
  badge.title = `Converted from ${originalText.trim()}`;
  return badge;
}

function removeBadges() {
  document.querySelectorAll(".flux-converted-badge").forEach((b) => b.remove());
}

function addBadges() {
  document.querySelectorAll(".flux-converted, [data-flux-converted]").forEach((el) => {
    if (!el.querySelector(".flux-converted-badge") && el.dataset.originalPrice) {
      el.appendChild(createBadge(el.dataset.originalPrice));
    }
  });
}

// ── Text Node Conversion ─────────────────────────────────────────

function convertTextNode(node) {
  if (processedNodes.has(node)) return;

  const parent = node.parentElement;
  if (
    !parent ||
    parent.isContentEditable ||
    parent.tagName === "SCRIPT" ||
    parent.tagName === "STYLE" ||
    parent.tagName === "TEXTAREA" ||
    parent.tagName === "INPUT" ||
    parent.closest("[data-flux-converted]")
  ) {
    return;
  }

  const cur = CURRENCIES[baseCurrency];
  if (!cur) return; 

  const text = node.textContent;
  
  // One fresh regex per text node — reset lastIndex after the test pass (BUG-002)
  const replaceRegex = createCurrencyRegex(baseCurrency);
  if (!replaceRegex) return;
  if (!replaceRegex.test(text)) return;
  replaceRegex.lastIndex = 0; // reset before the replace pass

  const newText = text.replace(replaceRegex, (match, amountStr, magnitudeWord) => {
    const amount = parseCurrency(amountStr, baseCurrency);
    if (!isNaN(amount) && amount > 0) {
      const multiplier = magnitudeWord
        ? (MAGNITUDE_WORDS[magnitudeWord.toLowerCase()] || 1)
        : 1;
      return formatCurrency(amount * multiplier * exchangeRate, targetCurrency);
    }
    return match;
  });

  if (text !== newText) {
    const span = document.createElement("span");
    span.className = "flux-converted";
    span.dataset.originalPrice = text;
    span.textContent = newText;
    // Styling handled by content.css (.flux-converted) — no inline style needed (SEC-003)

    if (showBadge) span.appendChild(createBadge(text));

    parent.replaceChild(span, node);
    processedNodes.add(span);
  }
}

// ── Structured Price Conversion (Amazon .a-price etc.) ───────────

function convertStructuredPrices(root) {
  if (!root || !root.querySelectorAll) return;

  const priceEls = root.querySelectorAll(".a-price:not([data-flux-converted]), .a-color-price:not([data-flux-converted]), .a-text-price:not([data-flux-converted])");

  const cur = CURRENCIES[baseCurrency];
  if (!cur) return;

  for (const priceEl of priceEls) {
    if (priceEl.closest("[data-flux-converted]") && priceEl.closest("[data-flux-converted]") !== priceEl) continue;

    const offscreen = priceEl.querySelector(".a-offscreen");
    const rawText = offscreen ? offscreen.textContent.trim() : priceEl.textContent.trim();

    // Fresh regex instance for each price element
    const regex = createCurrencyRegex(baseCurrency);
    if (!regex) continue;

    const match = rawText.match(regex);
    if (!match) continue;

    // match[0] is full match, we need the capture group
    // Re-parse with a named approach
    const singleRegex = new RegExp(cur.regexSource, 'i');
    const singleMatch = rawText.match(singleRegex);
    if (!singleMatch || !singleMatch[1]) continue;

    const magnitudeWord = singleMatch[2];
    const magnitudeMultiplier = magnitudeWord
      ? (MAGNITUDE_WORDS[magnitudeWord.toLowerCase()] || 1)
      : 1;
    const amount = parseCurrency(singleMatch[1], baseCurrency) * magnitudeMultiplier;
    if (isNaN(amount) || amount <= 0) continue;

    const convertedValue = amount * exchangeRate;
    const formatted = formatCurrency(convertedValue, targetCurrency);
    
    priceEl.dataset.fluxConverted = "true";
    priceEl.dataset.originalPrice = rawText;

    const symbolEl = priceEl.querySelector(".a-price-symbol");
    const wholeEl = priceEl.querySelector(".a-price-whole");
    const fractionEl = priceEl.querySelector(".a-price-fraction");

    if (symbolEl && wholeEl) {
      symbolEl.dataset.origText = symbolEl.textContent;
      symbolEl.textContent = CURRENCIES[targetCurrency]?.symbol || targetCurrency.toUpperCase();

      const numOnly = formatted.replace(CURRENCIES[targetCurrency]?.symbol || "", "").trim();
      let wholeStr = numOnly;
      let fractionStr = "";
      
      const sep = CURRENCIES[targetCurrency]?.locale?.startsWith('de') ? ',' : '.';
      if (numOnly.includes(sep)) {
        const parts = numOnly.split(sep);
        fractionStr = parts.pop();
        wholeStr = parts.join(sep);
      }

      const decimalEl = wholeEl.querySelector(".a-price-decimal");
      wholeEl.dataset.origText = wholeEl.textContent;
      wholeEl.textContent = wholeStr;
      if (decimalEl) wholeEl.appendChild(decimalEl);

      if (fractionEl) {
        fractionEl.dataset.origText = fractionEl.textContent;
        fractionEl.textContent = fractionStr;
      }
    } else if (!offscreen && !priceEl.querySelector('*')) {
      priceEl.dataset.origText = priceEl.textContent;
      priceEl.textContent = formatted;
    }

    if (offscreen) {
      offscreen.dataset.origText = offscreen.textContent;
      offscreen.textContent = formatted;
    }
    const ariaHidden = priceEl.querySelector('[aria-hidden="true"]');
    if (ariaHidden && !ariaHidden.querySelector(".a-price-symbol")) {
      ariaHidden.dataset.origText = ariaHidden.textContent;
      ariaHidden.textContent = formatted;
    }

    if (showBadge) priceEl.appendChild(createBadge(rawText));

    processedNodes.add(priceEl);
  }
}

// ── Main Conversion Entry Point ──────────────────────────────────

function convertPrices(node) {
  if (!isEnabled || isDomainDisabled()) return;
  if (!node || processedNodes.has(node)) return;

  if (node.nodeType === Node.TEXT_NODE) {
    convertTextNode(node);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // Early return: already converted — do NOT add to processedNodes so children
    // inside lazily-loaded subtrees can still be visited later (BUG-003)
    if (node.dataset && (node.dataset.originalPrice || node.dataset.fluxConverted)) return;

    convertStructuredPrices(node);

    const children = Array.from(node.childNodes);
    for (const child of children) {
      convertPrices(child);
    }
    // Mark only after conversion has actually run on this element (BUG-003)
    processedNodes.add(node);
  }
}

// ── Revert ───────────────────────────────────────────────────────

function revertPrices() {
  document.querySelectorAll(".flux-converted").forEach((el) => {
    if (!el.parentElement) return;
    if (el.dataset.originalPrice) {
      // Normal path: restore the original text node (EDGE-004)
      el.parentElement.replaceChild(document.createTextNode(el.dataset.originalPrice), el);
    } else {
      // originalPrice missing — unwrap span to preserve visible child content (EDGE-004)
      el.replaceWith(...el.childNodes);
    }
  });

  // Legacy class name support (in case page was converted before this update)
  document.querySelectorAll(".usd-inr-converted").forEach((el) => {
    if (!el.parentElement) return;
    if (el.dataset.originalPrice) {
      el.parentElement.replaceChild(document.createTextNode(el.dataset.originalPrice), el);
    } else {
      el.replaceWith(...el.childNodes);
    }
  });

  document.querySelectorAll("[data-flux-converted], [data-usd-converted]").forEach((priceEl) => {
    if (priceEl.dataset.origText !== undefined) {
       priceEl.textContent = priceEl.dataset.origText;
       delete priceEl.dataset.origText;
    } else {
      priceEl.querySelectorAll("[data-orig-text]").forEach((sub) => {
        if (sub.classList.contains("a-price-whole")) {
          const decimal = sub.querySelector(".a-price-decimal");
          sub.textContent = sub.dataset.origText;
          if (decimal) sub.appendChild(decimal);
        } else {
          sub.textContent = sub.dataset.origText;
        }
        delete sub.dataset.origText;
      });
    }

    priceEl.querySelectorAll(".flux-converted-badge, .usd-inr-badge").forEach((b) => b.remove());
    delete priceEl.dataset.fluxConverted;
    delete priceEl.dataset.usdConverted;
    delete priceEl.dataset.originalPrice;
  });

  processedNodes = new WeakSet();
}

// ── MutationObserver ─────────────────────────────────────────────

let pendingNodes = [];
let observerTimeout = null;

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      for (const node of mutation.addedNodes) {
        pendingNodes.push(node);
      }
    }
  }
  
  if (pendingNodes.length > 0) {
    if (observerTimeout) clearTimeout(observerTimeout);
    observerTimeout = setTimeout(() => {
      const nodes = pendingNodes;
      pendingNodes = [];
      requestAnimationFrame(() => {
        for (const node of nodes) {
          convertPrices(node);
        }
      });
    }, 100);
  }
});

// ── Initialization ───────────────────────────────────────────────

function initialize() {
  chrome.storage.local.get(
    ["exchangeRate", "baseCurrency", "targetCurrency", "enabled", "showBadge", "disabledDomains"],
    (data) => {
      if (data.exchangeRate) exchangeRate = data.exchangeRate;
      if (data.baseCurrency) baseCurrency = data.baseCurrency;
      if (data.targetCurrency) targetCurrency = data.targetCurrency;
      if (Object.prototype.hasOwnProperty.call(data, "enabled")) isEnabled = data.enabled;
      if (Object.prototype.hasOwnProperty.call(data, "showBadge")) showBadge = data.showBadge;
      if (Array.isArray(data.disabledDomains)) disabledDomains = data.disabledDomains;

      if (isEnabled && !isDomainDisabled()) {
        convertPrices(document.body);
        observer.observe(document.body, { childList: true, subtree: true });
      }
    },
  );
}

// ── Message Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "updateExchangeRate":
      // Cancel pending observer flush before mutating globals to prevent
      // a mid-flush convertPrices() running with a mixed old/new state (BUG-005)
      if (observerTimeout) {
        clearTimeout(observerTimeout);
        observerTimeout = null;
        pendingNodes = [];
      }
      exchangeRate = request.exchangeRate;
      baseCurrency = request.baseCurrency || baseCurrency;
      targetCurrency = request.targetCurrency || targetCurrency;
      if (isEnabled && !isDomainDisabled()) {
        revertPrices();
        convertPrices(document.body);
      }
      sendResponse({ status: "ok" });
      break;

    case "toggleEnabled":
      isEnabled = request.enabled;
      if (isEnabled && !isDomainDisabled()) {
        convertPrices(document.body);
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        observer.disconnect();
        revertPrices();
      }
      sendResponse({ status: "ok" });
      break;

    case "toggleDomain":
      disabledDomains = request.disabledDomains || [];
      if (isDomainDisabled()) {
        observer.disconnect();
        revertPrices();
      } else if (isEnabled) {
        processedNodes = new WeakSet();
        convertPrices(document.body);
        observer.observe(document.body, { childList: true, subtree: true });
      }
      sendResponse({ status: "ok" });
      break;

    case "toggleBadge":
      showBadge = request.showBadge;
      if (showBadge) {
        addBadges();
      } else {
        removeBadges();
      }
      sendResponse({ status: "ok" });
      break;
  }
});

initialize();
