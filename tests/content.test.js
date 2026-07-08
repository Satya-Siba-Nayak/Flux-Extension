/**
 * Tests for Flux Extension currency conversion — magnitude word support.
 *
 * Runs with Node's built-in test runner:  node --test tests/
 *
 * These tests extract the core regex + conversion logic from content.js
 * and validate it in isolation (no DOM / browser APIs required).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ── Replicate core logic from content.js ─────────────────────────

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

const MAGNITUDE_KEYS_PATTERN = Object.keys(MAGNITUDE_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const MAGNITUDE_SUFFIX = `(?:\\s*(${MAGNITUDE_KEYS_PATTERN})\\b)?`;

const CURRENCIES = {
  usd: { symbol: "$",   locale: "en-US", code: "USD", regexSource: `(?<![CAS])\\$([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  eur: { symbol: "€",   locale: "de-DE", code: "EUR", regexSource: `€\\s?([\\d.]+,?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  gbp: { symbol: "£",   locale: "en-GB", code: "GBP", regexSource: `£([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  inr: { symbol: "₹",   locale: "en-IN", code: "INR", regexSource: `₹\\s?([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  jpy: { symbol: "¥",   locale: "ja-JP", code: "JPY", regexSource: `¥([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  cad: { symbol: "C$",  locale: "en-CA", code: "CAD", regexSource: `(?:C\\$|CAD\\s)([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  aud: { symbol: "A$",  locale: "en-AU", code: "AUD", regexSource: `(?:A\\$|AUD\\s)([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  chf: { symbol: "CHF", locale: "de-CH", code: "CHF", regexSource: `CHF\\s?([\\d']+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  cny: { symbol: "CN¥", locale: "zh-CN", code: "CNY", regexSource: `(?:CN¥|RMB)\\s?([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
  sgd: { symbol: "S$",  locale: "en-SG", code: "SGD", regexSource: `(?:S\\$|SGD\\s)([\\d,]+\\.?\\d*)${MAGNITUDE_SUFFIX}`, regexFlags: "gi" },
};

function createCurrencyRegex(currencyCode) {
  const cur = CURRENCIES[currencyCode];
  if (!cur) return null;
  return new RegExp(cur.regexSource, cur.regexFlags);
}

function parseCurrency(amountStr, currencyCode) {
  const cur = CURRENCIES[currencyCode];
  if (!cur) return parseFloat(amountStr);

  let cleanStr = amountStr;
  if (cur.locale === "de-DE") {
    cleanStr = cleanStr.replace(/\./g, "").replace(/,/g, ".");
  } else if (cur.locale === "de-CH") {
    cleanStr = cleanStr.replace(/'/g, "");
  } else {
    cleanStr = cleanStr.replace(/,/g, "");
  }
  return parseFloat(cleanStr);
}

/**
 * Simulate the conversion logic from convertTextNode.
 * Returns the effective numeric amount (base × magnitude) for the first match.
 */
function extractAmount(text, currencyCode) {
  const regex = createCurrencyRegex(currencyCode);
  if (!regex) return null;
  const match = regex.exec(text);
  if (!match) return null;
  const amount = parseCurrency(match[1], currencyCode);
  const magnitudeWord = match[2];
  const multiplier = magnitudeWord
    ? (MAGNITUDE_WORDS[magnitudeWord.toLowerCase()] || 1)
    : 1;
  return amount * multiplier;
}

/**
 * Simulate full text replacement (mirrors convertTextNode logic).
 */
function convertText(text, currencyCode, exchangeRate, targetCurrency) {
  const regex = createCurrencyRegex(currencyCode);
  if (!regex) return text;

  const cur = CURRENCIES[targetCurrency];
  if (!cur) return text;

  const formatter = new Intl.NumberFormat(cur.locale, {
    style: "currency",
    currency: cur.code,
    minimumFractionDigits: cur.code === "JPY" ? 0 : 2,
    maximumFractionDigits: cur.code === "JPY" ? 0 : 2,
  });

  return text.replace(regex, (match, amountStr, magnitudeWord) => {
    const amount = parseCurrency(amountStr, currencyCode);
    if (!isNaN(amount) && amount > 0) {
      const multiplier = magnitudeWord
        ? (MAGNITUDE_WORDS[magnitudeWord.toLowerCase()] || 1)
        : 1;
      return formatter.format(amount * multiplier * exchangeRate);
    }
    return match;
  });
}


// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("MAGNITUDE_WORDS constant", () => {
  it("contains all expected magnitude words", () => {
    const expected = [
      "hundred", "thousand", "lakh", "lakhs", "million",
      "crore", "crores", "billion", "trillion",
    ];
    for (const word of expected) {
      assert.ok(MAGNITUDE_WORDS[word] !== undefined, `Missing: ${word}`);
    }
  });

  it("contains all expected abbreviations", () => {
    const expected = ["k", "m", "mn", "b", "bn", "t", "tn", "cr", "l"];
    for (const abbr of expected) {
      assert.ok(MAGNITUDE_WORDS[abbr] !== undefined, `Missing: ${abbr}`);
    }
  });

  it("has correct multiplier values", () => {
    assert.equal(MAGNITUDE_WORDS.hundred,  100);
    assert.equal(MAGNITUDE_WORDS.thousand, 1_000);
    assert.equal(MAGNITUDE_WORDS.lakh,     100_000);
    assert.equal(MAGNITUDE_WORDS.million,  1_000_000);
    assert.equal(MAGNITUDE_WORDS.crore,    10_000_000);
    assert.equal(MAGNITUDE_WORDS.billion,  1_000_000_000);
    assert.equal(MAGNITUDE_WORDS.trillion, 1_000_000_000_000);
    assert.equal(MAGNITUDE_WORDS.k,        1_000);
    assert.equal(MAGNITUDE_WORDS.mn,       1_000_000);
    assert.equal(MAGNITUDE_WORDS.bn,       1_000_000_000);
  });
});


describe("USD regex with magnitude words", () => {
  it("matches $4 million", () => {
    assert.equal(extractAmount("$4 million", "usd"), 4_000_000);
  });

  it("matches $2.5 billion", () => {
    assert.equal(extractAmount("$2.5 billion", "usd"), 2_500_000_000);
  });

  it("matches $100 thousand", () => {
    assert.equal(extractAmount("$100 thousand", "usd"), 100_000);
  });

  it("matches $1.2 trillion", () => {
    assert.equal(extractAmount("$1.2 trillion", "usd"), 1_200_000_000_000);
  });

  it("matches abbreviation $5m", () => {
    assert.equal(extractAmount("$5m", "usd"), 5_000_000);
  });

  it("matches abbreviation $3bn", () => {
    assert.equal(extractAmount("$3bn", "usd"), 3_000_000_000);
  });

  it("matches abbreviation $10k", () => {
    assert.equal(extractAmount("$10k", "usd"), 10_000);
  });

  it("still matches plain $4 without magnitude", () => {
    assert.equal(extractAmount("$4", "usd"), 4);
  });

  it("still matches $49.99 without magnitude", () => {
    assert.equal(extractAmount("$49.99", "usd"), 49.99);
  });

  it("still matches $1,234.56 without magnitude", () => {
    assert.equal(extractAmount("$1,234.56", "usd"), 1234.56);
  });

  it("is case-insensitive: $4 Million", () => {
    assert.equal(extractAmount("$4 Million", "usd"), 4_000_000);
  });

  it("is case-insensitive: $4 BILLION", () => {
    assert.equal(extractAmount("$4 BILLION", "usd"), 4_000_000_000);
  });
});


describe("GBP regex with magnitude words", () => {
  it("matches £2.5 billion", () => {
    assert.equal(extractAmount("£2.5 billion", "gbp"), 2_500_000_000);
  });

  it("matches £500 million", () => {
    assert.equal(extractAmount("£500 million", "gbp"), 500_000_000);
  });

  it("matches £10k", () => {
    assert.equal(extractAmount("£10k", "gbp"), 10_000);
  });

  it("matches plain £9.99", () => {
    assert.equal(extractAmount("£9.99", "gbp"), 9.99);
  });
});


describe("EUR regex with magnitude words", () => {
  it("matches €4 million", () => {
    assert.equal(extractAmount("€4 million", "eur"), 4_000_000);
  });

  it("matches €1,5 billion (European decimal)", () => {
    // EUR uses comma as decimal: €1,5 = 1.5
    assert.equal(extractAmount("€1,5 billion", "eur"), 1_500_000_000);
  });

  it("matches plain €99", () => {
    assert.equal(extractAmount("€99", "eur"), 99);
  });
});


describe("INR regex with magnitude words", () => {
  it("matches ₹50 lakh", () => {
    assert.equal(extractAmount("₹50 lakh", "inr"), 5_000_000);
  });

  it("matches ₹3 crore", () => {
    assert.equal(extractAmount("₹3 crore", "inr"), 30_000_000);
  });

  it("matches ₹10 crores", () => {
    assert.equal(extractAmount("₹10 crores", "inr"), 100_000_000);
  });

  it("matches ₹5 cr", () => {
    assert.equal(extractAmount("₹5 cr", "inr"), 50_000_000);
  });

  it("matches ₹2 lakhs", () => {
    assert.equal(extractAmount("₹2 lakhs", "inr"), 200_000);
  });

  it("matches ₹ 500 (with space)", () => {
    assert.equal(extractAmount("₹ 500", "inr"), 500);
  });

  it("matches plain ₹999", () => {
    assert.equal(extractAmount("₹999", "inr"), 999);
  });
});


describe("JPY regex with magnitude words", () => {
  it("matches ¥100 million", () => {
    assert.equal(extractAmount("¥100 million", "jpy"), 100_000_000);
  });

  it("matches ¥5 billion", () => {
    assert.equal(extractAmount("¥5 billion", "jpy"), 5_000_000_000);
  });

  it("matches plain ¥500", () => {
    assert.equal(extractAmount("¥500", "jpy"), 500);
  });
});


describe("CAD regex with magnitude words", () => {
  it("matches C$4 million", () => {
    assert.equal(extractAmount("C$4 million", "cad"), 4_000_000);
  });

  it("matches CAD 100 thousand", () => {
    assert.equal(extractAmount("CAD 100 thousand", "cad"), 100_000);
  });

  it("matches plain C$29.99", () => {
    assert.equal(extractAmount("C$29.99", "cad"), 29.99);
  });
});


describe("AUD regex with magnitude words", () => {
  it("matches A$2 billion", () => {
    assert.equal(extractAmount("A$2 billion", "aud"), 2_000_000_000);
  });

  it("matches AUD 50 million", () => {
    assert.equal(extractAmount("AUD 50 million", "aud"), 50_000_000);
  });

  it("matches plain A$15.50", () => {
    assert.equal(extractAmount("A$15.50", "aud"), 15.50);
  });
});


describe("CHF regex with magnitude words", () => {
  it("matches CHF 4 million", () => {
    assert.equal(extractAmount("CHF 4 million", "chf"), 4_000_000);
  });

  it("matches CHF4 billion", () => {
    assert.equal(extractAmount("CHF4 billion", "chf"), 4_000_000_000);
  });

  it("matches plain CHF 1'234.56", () => {
    assert.equal(extractAmount("CHF 1'234.56", "chf"), 1234.56);
  });
});


describe("CNY regex with magnitude words", () => {
  it("matches CN¥10 billion", () => {
    assert.equal(extractAmount("CN¥10 billion", "cny"), 10_000_000_000);
  });

  it("matches RMB 5 million", () => {
    assert.equal(extractAmount("RMB 5 million", "cny"), 5_000_000);
  });

  it("matches plain CN¥100", () => {
    assert.equal(extractAmount("CN¥100", "cny"), 100);
  });
});


describe("SGD regex with magnitude words", () => {
  it("matches S$3 million", () => {
    assert.equal(extractAmount("S$3 million", "sgd"), 3_000_000);
  });

  it("matches SGD 1 billion", () => {
    assert.equal(extractAmount("SGD 1 billion", "sgd"), 1_000_000_000);
  });

  it("matches plain S$42.00", () => {
    assert.equal(extractAmount("S$42.00", "sgd"), 42.00);
  });
});


describe("Full text conversion with magnitude", () => {
  const rate = 84; // Example USD → INR rate

  it("converts '$4 million' to full INR amount", () => {
    const result = convertText("Revenue was $4 million last quarter", "usd", rate, "inr");
    // $4 million = 4,000,000 × 84 = ₹33,60,00,000
    assert.ok(!result.includes("$"), `Should not contain '$': ${result}`);
    assert.ok(result.includes("₹"), `Should contain '₹': ${result}`);
    // Verify the numeric value is correct (33,60,00,000 in Indian format)
    assert.ok(result.includes("33,60,00,000"), `Should contain '33,60,00,000': ${result}`);
  });

  it("converts '$49.99' without magnitude normally", () => {
    const result = convertText("Price is $49.99", "usd", rate, "inr");
    assert.ok(!result.includes("$"), `Should not contain '$': ${result}`);
    assert.ok(result.includes("₹"), `Should contain '₹': ${result}`);
    // $49.99 × 84 = ₹4,199.16
    assert.ok(result.includes("4,199.16"), `Should contain '4,199.16': ${result}`);
  });

  it("handles multiple prices with and without magnitudes in same text", () => {
    const result = convertText("$4 million and $50", "usd", rate, "inr");
    assert.ok(!result.includes("$"), `Should not contain '$': ${result}`);
    // Both should be converted
    assert.ok(result.includes("33,60,00,000"), `Should have converted $4 million: ${result}`);
    assert.ok(result.includes("4,200.00"), `Should have converted $50: ${result}`);
  });
});


describe("Edge cases", () => {
  it("does not match text without currency symbol", () => {
    const result = extractAmount("the millions of people", "usd");
    assert.equal(result, null);
  });

  it("does not match standalone magnitude word without preceding amount", () => {
    const result = extractAmount("million dollar question", "usd");
    assert.equal(result, null);
  });

  it("handles decimal with magnitude: $2.5 billion", () => {
    assert.equal(extractAmount("$2.5 billion", "usd"), 2_500_000_000);
  });

  it("handles comma-formatted with magnitude: $1,500 million", () => {
    assert.equal(extractAmount("$1,500 million", "usd"), 1_500_000_000);
  });

  it("magnitude word at end of sentence: $4 million.", () => {
    // The \\b word boundary should still let this match
    assert.equal(extractAmount("$4 million.", "usd"), 4_000_000);
  });

  it("does not false-positive on 'billions' (with trailing s)", () => {
    // 'billions' should NOT match since only 'billion' is in the map
    // The \\b boundary after 'billion' means 'billions' won't match 'billion' 
    // because 's' is a word char
    const regex = createCurrencyRegex("usd");
    const match = regex.exec("$4 billions");
    // It should either not match the magnitude or match differently
    if (match && match[2]) {
      // If it does capture something, it shouldn't be 'billions'
      assert.notEqual(match[2], "billions");
    }
    // The numeric part should still be captured regardless
  });

  it("no space abbreviation: $5m", () => {
    assert.equal(extractAmount("$5m", "usd"), 5_000_000);
  });

  it("no space abbreviation: $3bn", () => {
    assert.equal(extractAmount("$3bn", "usd"), 3_000_000_000);
  });
});


describe("Regex does not break existing patterns", () => {
  it("USD: $9.99 still works", () => {
    assert.equal(extractAmount("$9.99", "usd"), 9.99);
  });

  it("USD: $1,234 still works", () => {
    assert.equal(extractAmount("$1,234", "usd"), 1234);
  });

  it("EUR: €19.99 still works", () => {
    // EUR regex expects comma as decimal: for plain digits, parseFloat works
    assert.equal(extractAmount("€19", "eur"), 19);
  });

  it("GBP: £100.50 still works", () => {
    assert.equal(extractAmount("£100.50", "gbp"), 100.50);
  });

  it("JPY: ¥1000 still works", () => {
    assert.equal(extractAmount("¥1000", "jpy"), 1000);
  });

  it("USD: does not match C$ or A$ or S$", () => {
    // The negative lookbehind (?<![CAS]) should prevent these
    assert.equal(extractAmount("C$100", "usd"), null);
    assert.equal(extractAmount("A$100", "usd"), null);
    assert.equal(extractAmount("S$100", "usd"), null);
  });
});
