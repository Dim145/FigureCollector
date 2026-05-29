import { useCallback, useSyncExternalStore } from "react";
import { applyTheme, storeTheme } from "../lib/theme.js";

// A tiny external store so every useTheme() consumer (nav toggle, settings,
// anything reacting to the theme) stays in lock-step without a context
// provider. The DOM (`<html data-theme>`) is the source of truth; we mirror
// it here so React can subscribe to changes.

let current =
  typeof document !== "undefined" &&
  document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";

const listeners = new Set();

function set(next) {
  current = applyTheme(next);
  storeTheme(current);
  listeners.forEach((l) => l());
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => "dark",
  );
  const toggle = useCallback(() => set(theme === "dark" ? "light" : "dark"), [theme]);
  const setTheme = useCallback((t) => set(t), []);
  return { theme, toggle, setTheme, isDark: theme === "dark" };
}
