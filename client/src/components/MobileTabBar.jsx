import { Link, useLocation } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { SECTIONS, ADD_ACTION, sectionForPath } from "../lib/navConfig.js";

/**
 * Bottom tab bar — the PWA thumb-reach nav, < lg only (Direction A).
 *
 * Five slots, sourced from navConfig so the bar never drifts from the rest of
 * the chrome: the first three sections (蒐 Collection · 目 Catalogue ·
 * 析 Insights) flanking a raised hanko-red "add" seal in the centre, then a
 * "⋯ Plus" slot that opens MobileNavSheet for the 4th section + everything
 * else. Above the bar the app keeps its top header (bell, theme, avatar) —
 * this only replaces the buried burger as the PRIMARY way to move around.
 *
 * Active state follows sectionForPath(), so a tab stays lit while the user is
 * anywhere inside its section (e.g. /collection/vitrines lights Collection),
 * matching the desktop primary nav.
 *
 * GPU-light: flat noir surface + gold hairline, no blur on the bar itself; the
 * active state is a laque diamond + gold kanji. Honors the iOS home-indicator
 * safe area, and every slot is a ≥44px hit target.
 */
export default function MobileTabBar({ onMore }) {
  const t = useT();
  const { pathname } = useLocation();
  const activeSection = sectionForPath(pathname);

  // Slots 1·2·4 (slot 3 is the centre add seal): the first three sections.
  const tabs = [SECTIONS[0], SECTIONS[1], SECTIONS[2]];

  return (
    <nav
      aria-label={t("nav.mobile_bar", { default: "Navigation rapide" })}
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-noir)]/96 border-t border-[var(--color-or)]/20"
      style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}
    >
      <span aria-hidden className="gold-rule absolute left-0 right-0 top-0 opacity-30" />
      <div className="grid grid-cols-5 items-end max-w-md mx-auto px-2 pt-1.5">
        {/* Slots 1 + 2 */}
        {tabs.slice(0, 2).map((section) => (
          <Tab key={section.id} section={section} active={activeSection?.id === section.id} t={t} />
        ))}

        {/* Centre — the raised hanko "add" seal, the one hot accent on the bar. */}
        <div className="relative flex justify-center">
          <Link
            to={ADD_ACTION.to}
            aria-label={t(ADD_ACTION.labelKey, { default: ADD_ACTION.labelDefault })}
            className="absolute -top-7 grid place-items-center w-12 h-12 rounded-full bg-[var(--color-laque)] text-[var(--color-ivoire)] text-2xl leading-none shadow-[0_8px_24px_-8px_oklch(0.62_0.19_25_/_0.6)] hover:bg-[var(--color-laque-bright)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-or)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-noir)]"
          >
            <span aria-hidden className="-mt-0.5">
              {ADD_ACTION.kanji}
            </span>
          </Link>
          {/* Spacer keeps the grid row height consistent. */}
          <span className="block h-10" aria-hidden />
        </div>

        {/* Slot 4 */}
        <Tab section={tabs[2]} active={activeSection?.id === tabs[2].id} t={t} />

        {/* Slot 5 — "⋯ Plus" opens the overflow sheet. */}
        <button
          type="button"
          onClick={onMore}
          aria-label={t("nav.more", { default: "Plus" })}
          className="tap-target flex flex-col items-center gap-0.5 py-1 text-[var(--color-ivoire-soft)] focus:outline-none focus-visible:text-[var(--color-or)]"
        >
          <span aria-hidden className="w-1 h-1 mb-0.5" />
          <span aria-hidden className="text-lg leading-none opacity-75">
            ⋯
          </span>
          <span className="text-[8.5px] uppercase tracking-[0.14em] leading-none mt-0.5 text-[var(--color-ivoire-soft)]/70">
            {t("nav.more", { default: "Plus" })}
          </span>
        </button>
      </div>
    </nav>
  );
}

// One section tab. Renders the section's lucide icon + kanji watermark + label.
// `active` is computed by sectionForPath() in the parent so a sub-page keeps
// the parent tab lit; we set aria-current accordingly.
function Tab({ section, active, t }) {
  const Icon = section.icon;
  return (
    <Link
      to={section.to}
      aria-current={active ? "page" : undefined}
      className="tap-target flex flex-col items-center gap-0.5 py-1 focus:outline-none focus-visible:text-[var(--color-or)]"
    >
      <span
        aria-hidden
        className="w-1 h-1 rotate-45 mb-0.5"
        style={{ background: active ? "var(--color-laque-bright)" : "transparent" }}
      />
      <Icon
        aria-hidden
        size={18}
        strokeWidth={1.75}
        style={{
          color: active ? "var(--color-or)" : "var(--color-ivoire-soft)",
          opacity: active ? 1 : 0.75,
        }}
      />
      <span
        className={`text-[8.5px] uppercase tracking-[0.14em] leading-none mt-0.5 ${
          active ? "text-[var(--color-or-pale)]" : "text-[var(--color-ivoire-soft)]/70"
        }`}
      >
        {t(section.labelKey, { default: section.labelDefault })}
      </span>
    </Link>
  );
}
