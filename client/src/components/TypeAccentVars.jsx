import { useEffect } from "react";
import { useFigureTypes } from "../hooks/useAdmin.js";

/**
 * Applies admin-customised figure-type accent colours as `--type-accent-<id>`
 * vars on :root. typeHue() reads `var(--type-accent-<id>, var(--type-<id>))`,
 * so consumers (glows, borders, chips…) pick the override up while the pristine
 * `--type-<id>` default stays untouched — the admin colour picker relies on
 * that base var to preview/reset to the true theme default. A type whose
 * `accent_color` is null gets no override var, so its default stands.
 *
 * Side-effect only; renders nothing. An invalid stored value is silently
 * dropped by `setProperty`, so a bad colour degrades to the default.
 */
export default function TypeAccentVars() {
  const { data } = useFigureTypes();

  useEffect(() => {
    const root = document.documentElement;
    const applied = [];
    for (const ft of data ?? []) {
      const id = (ft?.id ?? "")
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "");
      if (!id) continue;
      const prop = `--type-accent-${id}`;
      if (ft.accent_color) {
        root.style.setProperty(prop, ft.accent_color);
        applied.push(prop);
      } else {
        // Cleared/never-set → drop any prior override, revert to the default.
        root.style.removeProperty(prop);
      }
    }
    return () => {
      for (const prop of applied) root.style.removeProperty(prop);
    };
  }, [data]);

  return null;
}
