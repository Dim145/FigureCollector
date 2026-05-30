// FigureCollector — minimal i18n with lazy per-locale chunks.
//
// Each locale ships as its own async chunk via dynamic `import()`, so only the
// active language's ~50 KB of copy lands — never both. The fallback locale is
// loaded alongside the active one so unknown keys still resolve. A tiny gate
// covers the very first load (one small chunk, resolves in tens of ms); after
// that we never blank the app — a locale switch keeps showing the current copy
// until the new chunk lands.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const FALLBACK = "fr";
const SUPPORTED = ["fr", "en"];

// Vite turns each dynamic import into its own chunk. Keep them as literal
// arrow loaders (not a computed path) so the bundler can statically split them.
const LOADERS = {
  fr: () => import("./locales/fr.js"),
  en: () => import("./locales/en.js"),
};

// Module-level cache: locale → message table. Survives provider re-mounts and
// is shared across every useT() consumer.
const cache = {};

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
  supported: SUPPORTED,
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale);
  // Bumped every time a locale chunk finishes loading, to re-run `t`.
  const [version, setVersion] = useState(0);

  // Load the active locale (+ the fallback, for missing-key resolution) on
  // demand. Cached loads resolve synchronously on the next render.
  useEffect(() => {
    let cancelled = false;
    const need = locale === FALLBACK ? [locale] : [locale, FALLBACK];
    Promise.all(
      need.map(async (loc) => {
        if (!cache[loc]) cache[loc] = (await LOADERS[loc]()).default;
      }),
    )
      .then(() => {
        if (!cancelled) setVersion((v) => v + 1);
      })
      .catch(() => {
        /* a chunk failed to load — `t` falls back to keys, app still renders */
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

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
      const fb = cache[FALLBACK] ?? {};
      const table = cache[locale] ?? fb;
      let value = table[key] ?? fb[key];
      if (value == null) {
        // Caller-provided fallback for unknown keys — the server emits
        // achievement codes, status labels, kind/condition values that the
        // SPA wraps with `t(key, { default: serverLabel })`. Honour `default`
        // BEFORE returning `key` as the final fallback.
        if (params && Object.prototype.hasOwnProperty.call(params, "default")) {
          value = String(params.default);
        } else {
          value = key;
        }
      }
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (k === "default") continue; // metadata for the resolver above
          value = value.replaceAll(`{${k}}`, String(v));
        }
      }
      return value;
    },
    // `version` forces a fresh closure once a chunk lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, version],
  );

  const ctx = useMemo(
    () => ({ locale, setLocale, t, supported: SUPPORTED }),
    [locale, setLocale, t],
  );

  // First-load gate only: until *some* usable table exists, show a faint
  // watermark (matches the route-level Suspense fallback). Once a table is
  // cached we never gate again — a later locale switch keeps the current copy
  // visible until the new chunk lands.
  const ready = !!cache[locale] || !!cache[FALLBACK];
  if (!ready) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "var(--color-noir, #0a0807)",
          color: "var(--color-or-pale, rgba(214,178,113,0.6))",
          fontFamily: "var(--font-display, serif)",
          fontSize: "1.05rem",
          letterSpacing: "0.2em",
        }}
      >
        ◇
      </div>
    );
  }

  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext).t;
}

export function useI18n() {
  return useContext(I18nContext);
}
