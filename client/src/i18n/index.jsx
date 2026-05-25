// FigureCollector — minimal i18n.
//
// Static imports for now (FR + EN). Phase 2 will switch to lazy chunks via
// dynamic `import()` so each locale only ships when it's actually used.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import fr from "./locales/fr.js";
import en from "./locales/en.js";

const MESSAGES = { fr, en };
const FALLBACK = "fr";
const SUPPORTED = Object.keys(MESSAGES);

function detectLocale() {
  const stored = typeof localStorage !== "undefined" && localStorage.getItem("fc_locale");
  if (stored && SUPPORTED.includes(stored)) return stored;
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  for (const candidate of [nav, nav.slice(0, 2)]) {
    if (SUPPORTED.includes(candidate)) return candidate;
  }
  return FALLBACK;
}

const I18nContext = createContext({
  locale: FALLBACK,
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (!SUPPORTED.includes(next)) return;
    setLocaleState(next);
    try {
      localStorage.setItem("fc_locale", next);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const t = useCallback(
    (key, params) => {
      const table = MESSAGES[locale] ?? MESSAGES[FALLBACK];
      let value = table[key] ?? MESSAGES[FALLBACK][key];
      if (value == null) {
        // Caller-provided fallback for unknown keys — the server emits
        // achievement codes, status labels, kind/condition values that the
        // SPA wraps with `t(key, { default: serverLabel })`. If the locale
        // hasn't caught up yet, we'd otherwise leak the raw enum key into
        // the UI. Honour `default` BEFORE returning `key` as the final
        // fallback.
        if (params && Object.prototype.hasOwnProperty.call(params, "default")) {
          value = String(params.default);
        } else {
          value = key;
        }
      }
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          // `default` is metadata for the resolver above, not a placeholder.
          if (k === "default") continue;
          value = value.replaceAll(`{${k}}`, String(v));
        }
      }
      return value;
    },
    [locale],
  );

  const ctx = useMemo(() => ({ locale, setLocale, t, supported: SUPPORTED }), [locale, setLocale, t]);

  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext).t;
}

export function useI18n() {
  return useContext(I18nContext);
}
