import { useTheme } from "../hooks/useTheme.js";
import { useT } from "../i18n/index.jsx";

/**
 * Day / night toggle for the top bar. A single button that morphs a sun↔moon
 * glyph; the icon animates on press. Sits in the nav right-cluster next to the
 * locale switcher.
 */
export default function ThemeToggle({ className = "" }) {
  const t = useT();
  const { isDark, toggle } = useTheme();
  const label = isDark ? t("theme.to_light") : t("theme.to_dark");

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`theme-toggle group relative grid place-items-center w-8 h-8 border transition-colors leading-none border-[var(--color-or)]/35 text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] focus:outline-none focus-visible:border-[var(--color-or)] ${className}`}
    >
      <span
        aria-hidden
        className="block text-[15px] transition-transform duration-500 group-hover:rotate-[40deg]"
        style={{ transitionTimingFunction: "var(--ease-spring)" }}
      >
        {isDark ? "☾" : "☀"}
      </span>
    </button>
  );
}
