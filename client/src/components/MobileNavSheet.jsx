import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Search, Shield } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { SECTIONS, ACCOUNT_NAV, sectionForPath } from "../lib/navConfig.js";
import Drawer from "./ui/Drawer.jsx";

/**
 * "Plus" sheet — the mobile overflow nav (< lg), opened from the bottom tab
 * bar's "⋯ Plus" slot. Built on the shared <Drawer side="bottom"> (focus-trap,
 * Esc, scroll-lock, scrim, safe-area, slide-up — all for free).
 *
 * The bottom bar already carries Collection · Catalogue · Insights + the add
 * seal; this sheet surfaces the rest, all from navConfig:
 *   1. Communauté + its sub-pages.
 *   2. The CURRENT section's sub-pages (skipped when already in Communauté).
 *   3. Account — Récompenses · Notifications · Réglages (+ Admin when admin).
 *   4. A search row that opens the ⌘K command palette.
 *
 * Readability-first (was: cramped all-gold uppercase): full-width rows with an
 * ivoire label at a comfortable size, a quiet gold/laque glyph, a trailing
 * chevron affordance, ≥52px targets, hairline dividers, and a clear hanko-red
 * active state.
 */
export default function MobileNavSheet({ open, onClose, onSearch, isAdmin = false }) {
  const t = useT();
  const { pathname } = useLocation();

  const community = SECTIONS.find((s) => s.id === "community");
  const current = sectionForPath(pathname);
  // The current section's own sub-pages — unless we're already in Communauté
  // (rendered first) to avoid duplicating that block.
  const currentSub =
    current && current.id !== "community" && (current.children?.length ?? 0) > 1 ? current : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="bottom"
      title={t("nav.menu_title", { default: "Naviguer" })}
    >
      {/* Cancel the Drawer's content padding so rows run edge-to-edge. */}
      <div className="-m-5">
        {community ? <Group section={community} t={t} onClose={onClose} /> : null}
        {currentSub ? <Group section={currentSub} t={t} onClose={onClose} /> : null}

        <GroupHeader label={t("nav.account", { default: "Mon compte" })} />
        {ACCOUNT_NAV.map((it) => (
          <Row
            key={it.to}
            to={it.to}
            icon={it.icon}
            label={t(it.labelKey, { default: it.labelDefault })}
            onClose={onClose}
          />
        ))}
        {isAdmin ? (
          <Row to="/admin" icon={Shield} label={t("nav.admin")} accent onClose={onClose} />
        ) : null}

        {/* Search opens the command palette. */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onSearch();
          }}
          className="w-full flex items-center gap-3.5 px-5 min-h-[52px] py-2.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-sunken)] transition-colors focus:outline-none focus-visible:bg-[var(--surface-sunken)]"
        >
          <span className="w-6 flex items-center justify-center shrink-0 text-[var(--on-surface-muted)]">
            <Search size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <span className="flex-1 text-[15px]">{t("nav.search", { default: "Recherche" })}</span>
          <kbd className="font-mono text-[10px] tracking-wider text-[var(--on-surface-subtle)] border border-[var(--border)] rounded px-1.5 py-0.5">
            {t("palette.hint_open", { default: "⌘K" })}
          </kbd>
        </button>
      </div>
    </Drawer>
  );
}

// A section: a quiet eyebrow (kanji + label) then its sub-pages as full rows.
function Group({ section, t, onClose }) {
  return (
    <>
      <GroupHeader
        kanji={section.kanji}
        label={t(section.labelKey, { default: section.labelDefault })}
      />
      {(section.children ?? []).map((child) => (
        <Row
          key={child.to}
          to={child.to}
          end={child.end}
          kanji={child.kanji}
          label={t(child.labelKey, { default: child.labelDefault })}
          onClose={onClose}
        />
      ))}
    </>
  );
}

function GroupHeader({ kanji, label }) {
  return (
    <p className="px-5 pt-5 pb-1.5 text-[11px] uppercase tracking-[0.2em] text-[var(--on-surface-muted)] flex items-center gap-2">
      {kanji ? (
        <span aria-hidden className="ja not-italic text-sm leading-none text-[var(--accent)]">
          {kanji}
        </span>
      ) : null}
      {label}
    </p>
  );
}

// One row — a real NavLink (focusable, aria-current on the active route). Leading
// glyph is a kanji (section sub-pages) or a lucide icon (account rows); trailing
// chevron signals "navigates". Active = hanko red + a faint surface tint.
function Row({ to, end, kanji, icon: Icon, label, accent, onClose }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      className={({ isActive }) =>
        `flex items-center gap-3.5 px-5 min-h-[52px] py-2.5 border-b border-[var(--border-subtle)] transition-colors focus:outline-none focus-visible:bg-[var(--surface-sunken)] ${
          isActive
            ? "bg-[color-mix(in_oklab,var(--primary)_9%,transparent)] text-[var(--primary)]"
            : accent
              ? "text-[var(--accent)] hover:bg-[var(--surface-sunken)]"
              : "text-[var(--on-surface)] hover:bg-[var(--surface-sunken)]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="w-6 flex items-center justify-center shrink-0">
            {Icon ? (
              <Icon size={18} strokeWidth={1.75} aria-hidden />
            ) : kanji ? (
              <span
                aria-hidden
                className="ja not-italic text-base leading-none"
                style={{
                  color: isActive ? "var(--primary)" : "var(--accent)",
                  opacity: isActive ? 1 : 0.7,
                }}
              >
                {kanji}
              </span>
            ) : null}
          </span>
          <span className="flex-1 text-[15px]">{label}</span>
          <ChevronRight
            size={16}
            aria-hidden
            className="shrink-0 text-[var(--on-surface-subtle)]"
          />
        </>
      )}
    </NavLink>
  );
}
