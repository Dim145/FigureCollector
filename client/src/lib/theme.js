// Theme manager — dark (brand default) / light. Pure helpers, no React, so
// they can run synchronously at boot (main.jsx) before the first render to
// avoid a flash of the wrong theme. The actual colours live in index.css:
// `@theme` is the dark default, `[data-theme="light"]` overrides the vars.

const STORAGE_KEY = "fc-theme";

// Drives the browser UI chrome colour (status bar on mobile PWA).
const META_THEME_COLOR = { dark: "#08070a", light: "#f4efe6" };

export function resolveInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* localStorage unavailable (private mode) — fall through */
  }
  // First visit → dark, the brand identity (rather than following the OS,
  // which surprised dark-expecting users). The toggle is one tap away and
  // the choice is remembered thereafter.
  return "dark";
}

export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", META_THEME_COLOR[t]);
  }
  return t;
}

export function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Apply the resolved theme synchronously at boot. Returns the applied theme. */
export function initTheme() {
  return applyTheme(resolveInitialTheme());
}
