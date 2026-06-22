import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Camera, Check, LogOut, Shield } from "lucide-react";
import { useT, useI18n } from "../i18n/index.jsx";
import { useIsAdmin, useLogout, useMe } from "../hooks/useMe.js";
import { useVisualSearchStatus } from "../hooks/useVisualSearch.js";
import ThemeToggle from "./ThemeToggle.jsx";
import NotificationBell from "./NotificationBell.jsx";
import AuroraBackground from "./AuroraBackground.jsx";
import TypeAccentVars from "./TypeAccentVars.jsx";
import MobileTabBar from "./MobileTabBar.jsx";
import MobileNavSheet from "./MobileNavSheet.jsx";
import Avatar from "./ui/Avatar.jsx";
import DropdownMenu from "./ui/DropdownMenu.jsx";
import { SECTIONS, ADD_ACTION, ACCOUNT_NAV, sectionForPath } from "../lib/navConfig.js";

/**
 * Compact exhibition-style header — the redesigned chrome (Direction A).
 *
 * The whole nav model lives in navConfig.js; this surface just renders it:
 *   - Desktop primary bar = the 4 sections (蒐 Collection · 目 Catalogue ·
 *     析 Insights · 縁 Communauté) + the single ＋ Ajouter CTA pill. The active
 *     section is sectionForPath(pathname), so a tab stays lit anywhere inside
 *     its sub-tree.
 *   - A contextual sub-nav rail appears under the masthead whenever the active
 *     section has more than one sub-page (e.g. Collection → Pièces · Vitrines ·
 *     Souhaits · Pré-commandes). Horizontal scroll on phones, an inline rail on
 *     desktop — mirroring the AdminLayout pattern.
 *   - Everything secondary (Récompenses, Notifications, Réglages, language,
 *     Admin, Déconnexion) lives in an avatar DropdownMenu, keeping the chrome
 *     tight while one click away.
 *
 * On scroll the header gains a backdrop-blur (the ONLY allowed blur) + tighter
 * padding so the page reads underneath. On phones the header stays minimal
 * (logo · ＋ · bell · theme · avatar, no hamburger) — primary navigation lives
 * in the bottom tab bar + its "⋯ Plus" sheet (MobileNavSheet).
 */
export default function AppShell({ children }) {
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const visualSearch = useVisualSearchStatus();
  const navigate = useNavigate();
  const logout = useLogout();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef(null);
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Move keyboard focus to the new page on every route change. React
  // Router doesn't do this by default, so screen-reader users navigating
  // via links would never hear the new <main> landmark announced. We
  // give <main> tabIndex={-1} so it's focusable programmatically without
  // entering the tab order.
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const onSignOut = async () => {
    await logout.mutateAsync();
    navigate("/login");
  };

  const authed = me.data?.authenticated;
  const user = me.data?.user;

  // The section that owns the current route → primary active state + the
  // contextual sub-nav rail. A child is dropped from the rail when its feature
  // flag is off (e.g. photo search on an instance without it).
  const activeSection = sectionForPath(location.pathname);
  const flagOn = { visualSearch: !!visualSearch.data?.enabled };
  const subItems = activeSection?.children?.filter((c) => !c.flag || flagOn[c.flag]) ?? [];
  const showSubNav = subItems.length > 1;

  return (
    // The bottom tab bar (fixed, < lg) needs breathing room under the page so
    // it never sits on the footer's last line — hence the mobile-only pb.
    <div
      className={`min-h-dvh flex flex-col ${authed ? "pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:pb-0" : ""}`}
    >
      <AuroraBackground />
      <TypeAccentVars />
      {/* Skip link — hidden until focused, then jumps the user past the
          nav directly to <main>. Critical for keyboard users on a
          multi-row top bar. The styling is intentionally aggressive
          (gold pill, top-left) so it's unmissable when it appears. */}
      <a
        href="#fc-main"
        className="sr-only-focusable focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:bg-[var(--color-or)] focus:text-[var(--color-noir)] focus:px-3 focus:py-2 focus:text-[11px] focus:uppercase focus:tracking-[0.22em]"
      >
        {t("a11y.skip_to_content", { default: "Skip to content" })}
      </a>
      <header
        className={`sticky top-0 z-40 transition-all duration-300 ${
          scrolled
            ? "bg-[var(--color-noir)]/85 backdrop-blur-md border-b border-[var(--color-or)]/15"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div
          className={`max-w-7xl mx-auto px-5 flex items-center gap-6 transition-[padding] duration-300 ${
            scrolled ? "py-2" : "py-3"
          }`}
        >
          {/* Logomark */}
          <Link
            to="/"
            className="group flex items-baseline gap-2.5 shrink-0"
            aria-label="FigureCollector — accueil"
          >
            <span
              aria-hidden
              className="ja text-xl text-[var(--color-or)] leading-none transition-transform duration-500 group-hover:rotate-[6deg]"
            >
              像
            </span>
            <span className="display text-lg lg:text-xl text-[var(--color-ivoire)] tracking-tight group-hover:text-[var(--color-or-pale)] transition-colors leading-none hidden sm:inline whitespace-nowrap">
              FigureCollector
            </span>
          </Link>

          {/* Primary nav — the 4 sections (desktop). */}
          {authed ? (
            <nav
              aria-label={t("nav.primary", { default: "Navigation principale" })}
              className="hidden lg:flex items-center gap-0.5 text-[10.5px] uppercase tracking-[0.22em]"
            >
              {SECTIONS.map((section) => (
                <NavItem
                  key={section.id}
                  section={section}
                  active={activeSection?.id === section.id}
                  label={t(section.labelKey, { default: section.labelDefault })}
                />
              ))}
            </nav>
          ) : null}

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              type="button"
              title={t("palette.aria_open")}
              aria-label={t("palette.aria_open")}
              onClick={() =>
                window.dispatchEvent(new CustomEvent("figurecollector:toggle-palette"))
              }
              className="hidden md:inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] border border-[var(--color-or)]/30 text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors cursor-pointer leading-none focus:outline-none focus-visible:border-[var(--color-or)] focus-visible:text-[var(--color-or)]"
            >
              <kbd className="bg-transparent font-mono">{t("palette.hint_open")}</kbd>
            </button>

            {/* Primary CTA — the single + Ajouter pill. */}
            {authed ? (
              <Link
                to={ADD_ACTION.to}
                className="group flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[10.5px] uppercase tracking-[0.2em] hover:bg-[var(--color-laque-bright)] transition-colors leading-none whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-or)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-noir)]"
              >
                <span aria-hidden className="text-base leading-none -mt-0.5">
                  {ADD_ACTION.kanji}
                </span>
                <span className="hidden md:inline">
                  {t(ADD_ACTION.labelKey, { default: ADD_ACTION.labelDefault })}
                </span>
              </Link>
            ) : null}

            {authed ? <NotificationBell /> : null}

            <ThemeToggle />

            {authed ? (
              <UserMenu
                user={user}
                isAdmin={isAdmin}
                onSignOut={onSignOut}
                t={t}
                photoEnabled={flagOn.visualSearch}
              />
            ) : null}
            {/* No mobile hamburger: the bottom tab bar's "⋯ Plus" opens the
                MobileNavSheet, and the avatar holds account/preferences. */}
          </div>
        </div>

        {/* Contextual sub-nav — the active section's sub-pages. Horizontal
            scroll on phones, inline rail on desktop (mirrors AdminLayout). */}
        {authed && showSubNav ? <SubNav items={subItems} t={t} scrolled={scrolled} /> : null}

        <div
          aria-hidden
          className={`gold-rule absolute left-0 right-0 bottom-0 transition-opacity duration-300 ${
            scrolled ? "opacity-40" : "opacity-15"
          }`}
        />
      </header>

      {/* Page-enter transition: each route fades + rises in. Keyed by path so
          it replays on navigation; reduced-motion users get a static main. */}
      {reduceMotion ? (
        <main
          id="fc-main"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 relative focus:outline-none"
        >
          {children}
        </main>
      ) : (
        <motion.main
          id="fc-main"
          key={location.pathname}
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 relative focus:outline-none"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.main>
      )}

      {/* Bottom tab bar — the phone-first primary nav (< lg, signed-in) — and
          the "⋯ Plus" sheet it opens for every other destination. */}
      {authed ? <MobileTabBar onMore={() => setMobileOpen(true)} /> : null}
      {authed ? (
        <MobileNavSheet
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          isAdmin={isAdmin}
          onSearch={() => window.dispatchEvent(new CustomEvent("figurecollector:toggle-palette"))}
        />
      ) : null}

      <footer className="seigaiha relative z-10 mt-20 border-t border-[var(--color-or)]/25 py-8 bg-[var(--color-noir-deep)]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] uppercase tracking-[0.28em] text-[var(--color-ivoire-soft)]/80">
          <p className="flex items-center gap-3">
            <span aria-hidden className="ja text-[var(--color-or)]/70 text-base leading-none">
              像
            </span>
            FigureCollector ·{" "}
            <span className="font-mono normal-case tracking-wide">v{__APP_VERSION__}</span>
          </p>
          <nav
            aria-label={t("footer.links")}
            className="flex items-center gap-2 text-[var(--color-or-pale)]/85"
          >
            <a
              href="https://dim145.github.io/FigureCollector/"
              target="_blank"
              rel="noopener noreferrer"
              title={t("footer.docs")}
              aria-label={t("footer.docs")}
              className="grid place-items-center p-2 hover:text-[var(--color-or)] focus-visible:text-[var(--color-or)] transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </a>
            <a
              href="https://github.com/Dim145/FigureCollector"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
              aria-label="GitHub"
              className="grid place-items-center p-2 hover:text-[var(--color-or)] focus-visible:text-[var(--color-or)] transition-colors"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          </nav>
          <p className="display-italic normal-case text-[12px] tracking-normal text-[var(--color-or-pale)]/80">
            {t("app.tagline")}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// A primary-nav entry — lucide icon + label, with the signature Direction-A
// active treatment (laque text + a glowing rotated diamond underneath). `active`
// is computed from sectionForPath() so a sub-page keeps its parent section lit;
// aria-current marks it for assistive tech.
function NavItem({ section, active, label }) {
  const Icon = section.icon;
  return (
    <NavLink
      to={section.to}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 whitespace-nowrap transition-colors focus:outline-none focus-visible:text-[var(--color-or)] ${
        active
          ? "text-[var(--color-laque-bright)]"
          : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
      }`}
    >
      <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0" />
      {label}
      {active ? (
        <span
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          style={{ boxShadow: "0 0 10px var(--color-laque-bright)" }}
        />
      ) : null}
    </NavLink>
  );
}

// Contextual sub-nav rail — the active section's sub-pages. On phones it's a
// horizontal-scroll rail (so it never crowds the masthead); on desktop it
// settles into an inline row. Each entry is a NavLink with a kanji marker and
// the hanko-red active treatment; `end` children match exactly.
function SubNav({ items, t, scrolled }) {
  return (
    <nav
      aria-label={t("nav.secondary", { default: "Sous-navigation" })}
      className={`max-w-7xl mx-auto px-5 transition-[padding] duration-300 ${
        scrolled ? "pb-1.5" : "pb-2"
      }`}
    >
      <ul className="flex gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 lg:mx-0 lg:px-0">
        {items.map((child) => (
          <li key={child.to} className="shrink-0">
            <SubNavItem
              to={child.to}
              end={child.end}
              kanji={child.kanji}
              label={t(child.labelKey, { default: child.labelDefault })}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SubNavItem({ to, end, kanji, label }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `tap-target group relative flex items-center gap-2 whitespace-nowrap px-3 py-1.5 text-[10.5px] uppercase tracking-[0.18em] transition-colors focus:outline-none focus-visible:text-[var(--color-or)] ${
          isActive
            ? "text-[var(--color-laque-bright)]"
            : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className="ja not-italic text-sm leading-none transition-colors"
            style={{
              color: isActive ? "var(--color-laque-bright)" : "var(--color-or)",
              opacity: isActive ? 1 : 0.55,
            }}
          >
            {kanji}
          </span>
          {label}
          {isActive ? (
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
              style={{ boxShadow: "0 0 10px var(--color-laque-bright)" }}
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

// Account menu — the avatar DropdownMenu. Holds the account destinations (with
// their icons), the language toggle (one item per locale, active one checked),
// an Admin entry when the user is admin, and Logout as a destructive item set
// apart by a separator. Navigation items route via onSelect.
function UserMenu({ user, isAdmin, onSignOut, t, photoEnabled }) {
  const navigate = useNavigate();
  const { locale, setLocale, supported } = useI18n();
  const name = user?.display_name ?? user?.username ?? "?";

  const items = [
    // Photo search lives in the catalogue search bar (camera); surface it here
    // too as a quick entry — but only when the visual-search feature is on.
    ...(photoEnabled
      ? [
          {
            key: "photo",
            label: t("nav.recognize", { default: "Reconnaître par photo" }),
            icon: Camera,
            onSelect: () => navigate("/catalogue/photo"),
          },
          { separator: true },
        ]
      : []),
    ...ACCOUNT_NAV.map((it) => ({
      key: it.to,
      label: t(it.labelKey, { default: it.labelDefault }),
      icon: it.icon,
      onSelect: () => navigate(it.to),
    })),
    ...(isAdmin
      ? [
          { separator: true },
          {
            key: "admin",
            label: t("nav.admin"),
            icon: Shield,
            onSelect: () => navigate("/admin"),
          },
        ]
      : []),
    { separator: true },
    // Language — one item per supported locale; the active one carries a check
    // and is a no-op when re-selected. Keeps the switcher keyboard-reachable.
    ...supported.map((code) => ({
      key: `locale-${code}`,
      label: t(`nav.language.${code}`, {
        default: code === "fr" ? "Français" : code === "en" ? "English" : code.toUpperCase(),
      }),
      icon: locale === code ? Check : undefined,
      onSelect: () => setLocale(code),
    })),
    { separator: true },
    {
      key: "signout",
      label: t("nav.signout"),
      icon: LogOut,
      danger: true,
      onSelect: onSignOut,
    },
  ];

  return (
    <DropdownMenu
      aria-label={t("nav.account", { default: "Mon compte" })}
      trigger={
        <button
          type="button"
          aria-label={name}
          title={name}
          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-or)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-noir)]"
        >
          <Avatar name={name} size="sm" />
        </button>
      }
      items={items}
    />
  );
}
