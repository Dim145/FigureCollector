import { Link, NavLink } from "react-router-dom";
import { useT } from "../i18n/index.jsx";

/**
 * Bottom tab bar — the PWA thumb-reach nav, < lg only (Direction A).
 *
 * Five slots: the four everyday destinations flanking a raised hanko-red
 * "add" seal in the centre; the last slot ("Plus") opens the existing top
 * drawer for everything else. Above the bar the app keeps its top header
 * (bell, theme, avatar) — this only replaces the buried burger as the
 * PRIMARY way to move around on a phone.
 *
 * GPU-light: flat noir surface + gold hairline, no blur on the bar itself
 * (it sits over the page bottom where glass adds little), active state is a
 * laque diamond + gold text. Honors the iOS home-indicator safe area.
 */
export default function MobileTabBar({ onMore }) {
  const t = useT();

  const tabs = [
    { to: "/collection", kanji: "蒐", label: t("nav.collection.short") },
    { to: "/browse", kanji: "目", label: t("nav.browse") },
    null, // centre seal (add)
    { to: "/cote", kanji: "価", label: t("cote.title") },
  ];

  return (
    <nav
      aria-label={t("nav.mobile_bar", { default: "Navigation rapide" })}
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-noir)]/96 border-t border-[var(--color-or)]/20"
      style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}
    >
      <span
        aria-hidden
        className="gold-rule absolute left-0 right-0 top-0 opacity-30"
      />
      <div className="grid grid-cols-5 items-end max-w-md mx-auto px-2 pt-1.5">
        {tabs.map((tab, i) =>
          tab === null ? (
            <div key="add" className="relative flex justify-center">
              {/* Raised hanko seal — the one hot accent on the bar. */}
              <Link
                to="/figures/new"
                aria-label={t("nav.add_figure.short")}
                className="absolute -top-7 grid place-items-center w-12 h-12 rounded-full bg-[var(--color-laque)] text-[var(--color-ivoire)] text-2xl leading-none shadow-[0_8px_24px_-8px_oklch(0.62_0.19_25_/_0.6)] hover:bg-[var(--color-laque-bright)] transition-colors"
              >
                <span aria-hidden className="-mt-0.5">＋</span>
              </Link>
              {/* Spacer keeps the grid row height consistent. */}
              <span className="block h-10" aria-hidden />
            </div>
          ) : (
            <NavLink
              key={tab.to}
              to={tab.to}
              className="tap-target flex flex-col items-center gap-0.5 py-1"
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className="w-1 h-1 rotate-45 mb-0.5"
                    style={{
                      background: isActive ? "var(--color-laque-bright)" : "transparent",
                    }}
                  />
                  <span
                    aria-hidden
                    className="ja not-italic text-lg leading-none"
                    style={{
                      color: isActive ? "var(--color-or)" : "var(--color-ivoire-soft)",
                      opacity: isActive ? 1 : 0.75,
                    }}
                  >
                    {tab.kanji}
                  </span>
                  <span
                    className={`text-[8.5px] uppercase tracking-[0.14em] leading-none mt-0.5 ${
                      isActive
                        ? "text-[var(--color-or-pale)]"
                        : "text-[var(--color-ivoire-soft)]/70"
                    }`}
                  >
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          ),
        )}
        <button
          type="button"
          onClick={onMore}
          className="tap-target flex flex-col items-center gap-0.5 py-1 text-[var(--color-ivoire-soft)]"
        >
          <span aria-hidden className="w-1 h-1 mb-0.5" />
          <span aria-hidden className="text-lg leading-none opacity-75">⋯</span>
          <span className="text-[8.5px] uppercase tracking-[0.14em] leading-none mt-0.5 text-[var(--color-ivoire-soft)]/70">
            {t("nav.more", { default: "Plus" })}
          </span>
        </button>
      </div>
    </nav>
  );
}
