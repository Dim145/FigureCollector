import { useEffect } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../i18n/index.jsx";

/**
 * "Plus" sheet — the dedicated mobile navigation menu (< lg), opened from the
 * bottom tab bar's "⋯ Plus" slot. Rises from the bottom over a dimmed page.
 *
 * It lists every destination NOT already on the bottom bar (which carries
 * Collection · Catalogue · La Cote) plus search — strictly *navigation*.
 * Account + preferences live in the avatar menu instead, so the two menus
 * never overlap. The old top-bar hamburger (which opened a duplicate drawer)
 * is gone; this is the single way to reach the rest of the app on a phone.
 *
 * Direction A: noir-soft surface under a gold hairline crown, laque-diamond
 * row bullets, a crisp ✕ close. GPU-light — one transform/opacity rise on
 * open, nothing per row; honours reduced-motion and the home-indicator inset.
 */
export default function MobileNavSheet({ open, onClose, items, onSearch }) {
  const t = useT();
  const reduce = useReducedMotion();

  // Esc closes; lock the page scroll behind the sheet while it's up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const title = t("nav.menu_title", { default: "Naviguer" });

  return createPortal(
    <div
      className="lg:hidden fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Dimmed page — tap to dismiss. */}
      <motion.button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[var(--color-noir)]/80 backdrop-blur-sm"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />

      {/* The sheet itself, anchored to the bottom. */}
      <motion.div
        className="absolute inset-x-0 bottom-0 max-h-[86dvh] flex flex-col bg-[var(--color-noir-soft)] border-t border-[var(--color-or)]/30"
        style={{ boxShadow: "0 -50px 90px -45px rgba(0,0,0,0.9)" }}
        initial={reduce ? false : { y: "14%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        <span aria-hidden className="gold-rule absolute left-0 right-0 top-0 opacity-40" />

        <header className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0">
          <p className="micro flex items-center gap-2 text-[var(--color-or-pale)]">
            <span aria-hidden className="ja not-italic text-sm text-[var(--color-or)] leading-none">
              像
            </span>
            {title}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.close", { default: "Fermer" })}
            className="tap-target grid place-items-center w-10 h-10 -mr-2 border border-[var(--color-or)]/30 text-[var(--color-or-pale)] hover:text-[var(--color-or)] hover:border-[var(--color-or)]/60 transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </header>
        <span aria-hidden className="gold-rule w-12 ml-5 mb-1 opacity-60" />

        <nav
          aria-label={title}
          className="overflow-y-auto px-2"
          style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 4.5rem))" }}
        >
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === "/admin" ? false : undefined}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3.5 px-4 py-3.5 text-[13px] uppercase tracking-[0.2em] border-b border-[var(--color-or)]/8 transition-colors ${
                  isActive
                    ? "text-[var(--color-or)]"
                    : it.accent
                      ? "text-[var(--color-or-pale)] hover:text-[var(--color-or)]"
                      : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
                }`
              }
            >
              <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-current opacity-50 shrink-0" />
              {it.label}
            </NavLink>
          ))}

          {/* Command palette — search lives with navigation, not the account menu. */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSearch();
            }}
            className="w-full flex items-center gap-3.5 px-4 py-3.5 text-[13px] uppercase tracking-[0.2em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
          >
            <span aria-hidden className="ja not-italic text-base leading-none opacity-80">
              検
            </span>
            {t("nav.search", { default: "Recherche" })}
          </button>
        </nav>
      </motion.div>
    </div>,
    document.body,
  );
}
