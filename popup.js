// Popup script for Flux Currency Converter

document.addEventListener("DOMContentLoaded", () => {
  const baseCurrencySelect = document.getElementById("baseCurrency");
  const targetCurrencySelect = document.getElementById("targetCurrency");
  const swapBtn = document.getElementById("swapCurrencies");
  const currentRateEl = document.getElementById("currentRate");
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const refreshBtn = document.getElementById("refreshRate");
  const showBadgeToggle = document.getElementById("showBadge");
  const enabledToggle = document.getElementById("enabled");
  const themeBtn = document.getElementById("themeBtn");
  
  const sitePowerBtn = document.getElementById("sitePower");
  const disabledSection = document.getElementById("disabledSection");
  const disabledList = document.getElementById("disabledList");

  const rateDisplayEl = document.getElementById("rateDisplay");
  const calcInput = document.getElementById("calcInput");
  const calcResult = document.getElementById("calcResult");
  const calcBaseSymbol = document.getElementById("calcBaseSymbol");
  const calcTargetSymbol = document.getElementById("calcTargetSymbol");

  let currentRootDomain = null;
  let showInverseRate = false;
  let currentRateValue = null;
  let lastUpdateValue = null;
  let disabledDomains = [];

  // ── Request tracking for race condition prevention ────────────
  let currentRequestId = 0;
  let debounceTimer = null;

  // ── Currency Symbols Map ──────────────────────────────────────
  const SYMBOLS = {
    usd: "$", eur: "€", gbp: "£", inr: "₹", jpy: "¥", 
    cad: "C$", aud: "A$", chf: "CHF", cny: "CN¥", sgd: "S$"
  };

  // ── Domain Utilities ──────────────────────────────────────────
  function getRootDomain(hostname) {
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    const ccSLDs = ["co", "com", "org", "net", "gov", "edu", "ac"];
    if (ccSLDs.includes(parts[parts.length - 2])) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  }

  // ── Initialize ────────────────────────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url) {
      try {
        const url = new URL(tab.url);
        // Disable site-power for non-web protocols (chrome://, about:, extensions) (EDGE-003)
        if (!url.hostname
            || url.protocol === "chrome:"
            || url.protocol === "about:"
            || url.protocol === "chrome-extension:"
            || url.protocol === "moz-extension:") {
          sitePowerBtn.disabled = true;
        } else {
          currentRootDomain = getRootDomain(url.hostname);
        }
      } catch {
        sitePowerBtn.disabled = true;
      }
    } else {
      sitePowerBtn.disabled = true;
    }
    loadSettings();
  });

  function loadSettings() {
    chrome.storage.local.get(
      ["baseCurrency", "targetCurrency", "exchangeRate", "lastUpdate", "enabled", "showBadge", "disabledDomains", "theme"],
      (data) => {
        if (data.baseCurrency) baseCurrencySelect.value = data.baseCurrency;
        if (data.targetCurrency) targetCurrencySelect.value = data.targetCurrency;
        
        enabledToggle.checked = Object.prototype.hasOwnProperty.call(data, "enabled") ? data.enabled : true;
        showBadgeToggle.checked = Object.prototype.hasOwnProperty.call(data, "showBadge") ? data.showBadge : true;
        
        const currentTheme = data.theme || 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);

        disabledDomains = Array.isArray(data.disabledDomains) ? data.disabledDomains : [];

        updateRateDisplay(data.exchangeRate, data.lastUpdate);
        updateSiteUI();
        renderDisabledList();
      }
    );
  }

  // ── Exchange Rate Logic ───────────────────────────────────────
  
  function updateCalculator() {
    const base = baseCurrencySelect.value;
    const target = targetCurrencySelect.value;
    if (calcBaseSymbol) calcBaseSymbol.textContent = base.toUpperCase();
    if (calcTargetSymbol) calcTargetSymbol.textContent = target.toUpperCase();

    if (!currentRateValue || !calcResult || !calcInput) {
      if (calcResult) calcResult.textContent = "-";
      return;
    }

    const val = parseFloat(calcInput.value);
    if (isNaN(val) || val < 0) {
      calcResult.textContent = "-";
      return;
    }

    const result = val * currentRateValue;
    
    let formattedResult;
    if (result < 0.01) formattedResult = result.toFixed(6);
    else if (result < 1) formattedResult = result.toFixed(4);
    else if (target === 'jpy') formattedResult = result.toFixed(0);
    else formattedResult = result.toFixed(2);

    calcResult.textContent = formattedResult;
  }

  function updateRateDisplay(rate, lastUpdate) {
    currentRateValue = rate;
    lastUpdateValue = lastUpdate;

    if (!rate) {
      currentRateEl.textContent = "Unavailable";
      lastUpdatedEl.textContent = "Check connection";
      updateCalculator();
      return;
    }
    
    const base = baseCurrencySelect.value;
    const target = targetCurrencySelect.value;
    
    // Format nicely based on value (e.g., JPY needs no decimals, small values need more)
    let formattedRate;
    if (showInverseRate) {
      const inverseRate = 1 / rate;
      if (inverseRate < 0.01) formattedRate = inverseRate.toFixed(6);
      else if (inverseRate < 1) formattedRate = inverseRate.toFixed(4);
      else if (base === 'jpy') formattedRate = inverseRate.toFixed(0);
      else formattedRate = inverseRate.toFixed(2);

      currentRateEl.textContent = `1 ${SYMBOLS[target] || target.toUpperCase()} = ${formattedRate} ${SYMBOLS[base] || base.toUpperCase()}`;
    } else {
      if (rate < 0.01) formattedRate = rate.toFixed(6);
      else if (rate < 1) formattedRate = rate.toFixed(4);
      else if (target === 'jpy') formattedRate = rate.toFixed(0);
      else formattedRate = rate.toFixed(2);

      currentRateEl.textContent = `1 ${SYMBOLS[base] || base.toUpperCase()} = ${formattedRate} ${SYMBOLS[target] || target.toUpperCase()}`;
    }
    
    if (lastUpdate) {
      lastUpdatedEl.textContent = `Updated ${timeAgo(lastUpdate)}`;
    }

    updateCalculator();
  }

  /**
   * Debounced currency change handler.
   * Coalesces rapid changes into a single request and tracks request IDs
   * to discard stale responses from earlier requests.
   */
  function handleCurrencyChange() {
    if (baseCurrencySelect.value === targetCurrencySelect.value) {
      // Prevent same currency by swapping
      swapCurrencies();
      return;
    }

    currentRateEl.textContent = "Loading...";
    
    // Clear any pending debounced request
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const base = baseCurrencySelect.value;
      const target = targetCurrencySelect.value;
      const thisRequestId = ++currentRequestId;

      chrome.runtime.sendMessage({ 
        action: "forceUpdate", 
        baseCurrency: base, 
        targetCurrency: target 
      }, (response) => {
        // Discard if a newer request has been made since this one
        if (thisRequestId !== currentRequestId) return;

        if (chrome.runtime.lastError) {
          chrome.storage.local.get(["exchangeRate", "lastUpdate"], (data) => {
            if (thisRequestId === currentRequestId) {
              updateRateDisplay(data.exchangeRate, data.lastUpdate);
            }
          });
          return;
        }

        if (response?.status === "stale") {
          // Background discarded as stale — fall back to last known rate in storage
          // to avoid an infinite recursive loop (BUG-004)
          chrome.storage.local.get(["exchangeRate", "lastUpdate"], (data) => {
            if (thisRequestId === currentRequestId) {
              updateRateDisplay(data.exchangeRate, data.lastUpdate);
            }
          });
          return;
        }

        if (response?.exchangeRate) {
          updateRateDisplay(response.exchangeRate, response.lastUpdate);
        } else {
          // Fallback: read from storage if response didn't include rate
          chrome.storage.local.get(["exchangeRate", "lastUpdate"], (data) => {
            if (thisRequestId === currentRequestId) {
              updateRateDisplay(data.exchangeRate, data.lastUpdate);
            }
          });
        }
      });
    }, 300);
  }

  baseCurrencySelect.addEventListener("change", handleCurrencyChange);
  targetCurrencySelect.addEventListener("change", handleCurrencyChange);

  function swapCurrencies() {
    const groups = document.querySelectorAll('.select-group');
    if (groups.length >= 2) {
      groups[0].classList.add('swapping-down');
      groups[1].classList.add('swapping-up');
      
      setTimeout(() => {
        const temp = baseCurrencySelect.value;
        baseCurrencySelect.value = targetCurrencySelect.value;
        targetCurrencySelect.value = temp;
        handleCurrencyChange();
        
        groups[0].classList.remove('swapping-down');
        groups[1].classList.remove('swapping-up');
      }, 200);
    } else {
      const temp = baseCurrencySelect.value;
      baseCurrencySelect.value = targetCurrencySelect.value;
      targetCurrencySelect.value = temp;
      handleCurrencyChange();
    }
  }
  
  swapBtn.addEventListener("click", swapCurrencies);

  refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("spinning");
    currentRateEl.textContent = "Loading...";
    const thisRequestId = ++currentRequestId;

    chrome.runtime.sendMessage({ 
      action: "forceUpdate", 
      baseCurrency: baseCurrencySelect.value, 
      targetCurrency: targetCurrencySelect.value 
    }, (response) => {
      refreshBtn.classList.remove("spinning");
      
      if (thisRequestId !== currentRequestId) return;

      if (chrome.runtime.lastError) {
        chrome.storage.local.get(["exchangeRate", "lastUpdate"], (data) => {
          if (thisRequestId === currentRequestId) {
            updateRateDisplay(data.exchangeRate, data.lastUpdate);
          }
        });
        return;
      }

      if (response?.exchangeRate) {
        updateRateDisplay(response.exchangeRate, response.lastUpdate);
      } else {
        chrome.storage.local.get(["exchangeRate", "lastUpdate"], (data) => {
          if (thisRequestId === currentRequestId) {
            updateRateDisplay(data.exchangeRate, data.lastUpdate);
          }
        });
      }
    });
  });

  // ── Global Toggles ────────────────────────────────────────────

  showBadgeToggle.addEventListener("change", () => {
    const val = showBadgeToggle.checked;
    chrome.storage.local.set({ showBadge: val });
    notifyTabs({ action: "toggleBadge", showBadge: val });
  });

  enabledToggle.addEventListener("change", () => {
    const val = enabledToggle.checked;
    chrome.storage.local.set({ enabled: val });
    notifyTabs({ action: "toggleEnabled", enabled: val });
  });

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const newTheme = isLight ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      chrome.storage.local.set({ theme: newTheme });
    });
  }

  // ── Site Power ────────────────────────────────────────────────

  function updateSiteUI() {
    if (!currentRootDomain) return;
    const isDisabled = disabledDomains.includes(currentRootDomain);
    sitePowerBtn.classList.toggle("active", !isDisabled);
    sitePowerBtn.classList.toggle("inactive", isDisabled);
  }

  sitePowerBtn.addEventListener("click", () => {
    if (!currentRootDomain) return;
    
    const idx = disabledDomains.indexOf(currentRootDomain);
    if (idx >= 0) disabledDomains.splice(idx, 1);
    else disabledDomains.push(currentRootDomain);

    chrome.storage.local.set({ disabledDomains }, () => {
      updateSiteUI();
      renderDisabledList();
      notifyTabs({ action: "toggleDomain", disabledDomains });
    });
  });

  // ── Disabled Sites ────────────────────────────────────────────

  function renderDisabledList() {
    disabledList.innerHTML = "";
    if (disabledDomains.length === 0) {
      disabledSection.style.display = "none";
      return;
    }
    
    disabledSection.style.display = "block";
    for (const domain of disabledDomains) {
      const item = document.createElement("div");
      item.className = "disabled-item";
      item.textContent = domain;

      const btn = document.createElement("button");
      btn.className = "remove-btn";
      btn.innerHTML = "&times;";
      btn.title = "Re-enable";
      btn.onclick = () => {
        disabledDomains = disabledDomains.filter((d) => d !== domain);
        chrome.storage.local.set({ disabledDomains }, () => {
          updateSiteUI();
          renderDisabledList();
          notifyTabs({ action: "toggleDomain", disabledDomains });
        });
      };
      
      item.appendChild(btn);
      disabledList.appendChild(item);
    }
  }

  // ── Calculator & Rate Toggle Listeners ──────────────────────────
  if (rateDisplayEl) {
    rateDisplayEl.addEventListener("click", () => {
      showInverseRate = !showInverseRate;
      updateRateDisplay(currentRateValue, lastUpdateValue);
    });
  }

  if (calcInput) {
    calcInput.addEventListener("input", updateCalculator);
  }

  // ── Helpers ───────────────────────────────────────────────────

  function notifyTabs(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
      }
    });
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleDateString();
  }
});
