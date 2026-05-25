import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useLogout, useMe } from "../hooks/useMe.js";
import LocaleSwitcher from "./LocaleSwitcher.jsx";
import NotificationBell from "./NotificationBell.jsx";

/**
 * Compact exhibition-style header.
 *
 * Architecture is the redesign here: only 4 destinations are surfaced in the
 * primary bar (Collection · Catalogue · Pré-commandes · Statistiques). The
 * "+ Ajouter" pill is the only call-to-action. Everything secondary (Activité,
 * Sceaux, Admin, Paramètres, Déconnexion) lives in an avatar popover, which
 * keeps the chrome tight while remaining one click away.
 *
 * On scroll the header gains a backdrop-blur + tighter padding so the page
 * content reads underneath. Mobile collapses every nav item into a single
 * hamburger drawer.
 */
export default function AppShell({ children }) {
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const logout = useLogout();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef(null);
  const location = useLocation();

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

  const primary = [
    { to: "/collection", label: t("nav.collection.short") },
    { to: "/browse", label: t("nav.browse") },
    { to: "/preorders", label: t("nav.preorders.short") },
    { to: "/stats", label: t("nav.stats") },
  ];

  const secondary = [
    { to: "/activity", label: t("activity.title") },
    { to: "/achievements", label: t("achievements.title") },
    ...(isAdmin
      ? [{ to: "/admin", label: t("nav.admin"), accent: true }]
      : []),
    { to: "/settings", label: t("nav.settings") },
  ];

  const authed = me.data?.authenticated;
  const user = me.data?.user;

  return (
    <div className="min-h-dvh flex flex-col">
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

          {/* Primary nav */}
          <nav
            aria-label="navigation principale"
            className="hidden lg:flex items-center gap-0.5 text-[10.5px] uppercase tracking-[0.22em]"
          >
            {primary.map((it) => (
              <NavItem key={it.to} to={it.to}>
                {it.label}
              </NavItem>
            ))}
          </nav>

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <kbd
              title="⌘K"
              aria-hidden
              className="hidden md:inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] border border-[var(--color-or)]/30 text-[var(--color-or-pale)] hover:border-[var(--color-or)] transition-colors cursor-pointer leading-none"
            >
              {t("palette.hint_open")}
            </kbd>

            {/* Primary CTA */}
            {authed ? (
              <Link
                to="/figures/new"
                className="group flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-or)] text-[var(--color-noir)] text-[10.5px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors leading-none whitespace-nowrap"
              >
                <span aria-hidden className="text-base leading-none -mt-0.5">＋</span>
                <span className="hidden md:inline">{t("nav.add_figure.short")}</span>
              </Link>
            ) : null}

            {authed ? <NotificationBell /> : null}

            <LocaleSwitcher />

            {authed ? (
              <UserMenu
                user={user}
                items={secondary}
                onSignOut={onSignOut}
                t={t}
              />
            ) : null}

            {/* Hamburger (mobile + medium) */}
            <button
              type="button"
              onClick={() => setMobileOpen((x) => !x)}
              aria-expanded={mobileOpen}
              aria-label="Menu"
              className="lg:hidden text-[var(--color-or-pale)] hover:text-[var(--color-or)] p-1 transition-colors"
            >
              <Burger open={mobileOpen} />
            </button>
          </div>
        </div>

        <div
          aria-hidden
          className={`gold-rule absolute left-0 right-0 bottom-0 transition-opacity duration-300 ${
            scrolled ? "opacity-40" : "opacity-15"
          }`}
        />

        {/* Mobile drawer */}
        {mobileOpen ? (
          <div className="lg:hidden bg-[var(--color-noir)]/95 backdrop-blur-md border-t border-[var(--color-or)]/15">
            <nav className="max-w-7xl mx-auto px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[11px] uppercase tracking-[0.22em]">
              {[...primary, ...secondary].map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.to === "/admin" ? false : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `py-1.5 transition-colors ${
                      isActive
                        ? "text-[var(--color-or)]"
                        : it.accent
                          ? "text-[var(--color-or-pale)] hover:text-[var(--color-or)]"
                          : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
                    }`
                  }
                >
                  {it.label}
                </NavLink>
              ))}
              {authed ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    onSignOut();
                  }}
                  className="col-span-2 mt-2 pt-3 border-t border-[var(--color-or)]/15 text-left text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
                >
                  {t("nav.signout")}
                </button>
              ) : null}
            </nav>
          </div>
        ) : null}
      </header>

      <main id="fc-main" ref={mainRef} tabIndex={-1} className="flex-1 relative focus:outline-none">
        {children}
      </main>

      <footer className="mt-20 border-t border-[var(--color-or)]/10 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-[10px] uppercase tracking-[0.28em] text-[var(--color-ivoire-soft)]/60">
          <p className="flex items-center gap-3">
            <span aria-hidden className="ja text-[var(--color-or)]/60 text-base leading-none">
              像
            </span>
            FigureCollector ·{" "}
            <span className="font-mono normal-case tracking-wide">v0.1</span>
          </p>
          <p className="display-italic normal-case text-[12px] tracking-normal text-[var(--color-or-pale)]/70">
            {t("app.tagline_en")}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative px-3 py-1.5 whitespace-nowrap transition-colors ${
          isActive
            ? "text-[var(--color-or)]"
            : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive ? (
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 bg-[var(--color-or)] rotate-45"
              style={{ boxShadow: "0 0 10px var(--color-or)" }}
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function UserMenu({ user, items, onSignOut, t }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (user?.display_name ?? user?.username ?? "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user?.display_name ?? user?.username ?? ""}
        className={`w-8 h-8 grid place-items-center border transition-colors leading-none ${
          open
            ? "border-[var(--color-or)] bg-[var(--color-or)]/15 text-[var(--color-or)]"
            : "border-[var(--color-or)]/35 text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)]"
        }`}
      >
        <span className="display text-sm">{initial}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 bg-[var(--color-noir-soft)] border border-[var(--color-or)]/35 reveal"
          style={{
            "--i": 0,
            "--delay": "0ms",
            boxShadow:
              "0 30px 80px -30px rgba(0,0,0,0.85), inset 0 1px 0 oklch(0.92 0.03 75 / 0.06)",
          }}
        >
          <header className="px-4 py-3 border-b border-[var(--color-or)]/15">
            <p className="display text-base text-[var(--color-ivoire)] leading-tight truncate">
              {user?.display_name ?? user?.username}
            </p>
            <p className="font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/70 mt-0.5 truncate">
              @{user?.username}
            </p>
          </header>

          <nav className="py-1" aria-label="navigation secondaire">
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/admin" ? false : undefined}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition-colors ${
                    isActive
                      ? "text-[var(--color-or)] bg-[var(--color-or)]/8"
                      : it.accent
                        ? "text-[var(--color-or-pale)] hover:bg-[var(--color-or)]/8"
                        : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)] hover:bg-[var(--color-or)]/5"
                  }`
                }
              >
                <span
                  aria-hidden
                  className="w-1 h-1 bg-current opacity-50 rotate-45 shrink-0"
                />
                {it.label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-[var(--color-or)]/15">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-[11px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] hover:bg-[var(--color-laque)]/10 transition-colors"
            >
              <span aria-hidden className="text-base leading-none -mt-0.5">↗</span>
              {t("nav.signout")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Burger({ open }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    >
      <line
        x1="3" y1="6" x2="19" y2="6"
        style={{
          transition: "transform 250ms var(--ease-curtain), opacity 200ms var(--ease-quick)",
          transformOrigin: "center",
          transform: open ? "translate(0, 5px) rotate(45deg)" : "",
        }}
      />
      <line
        x1="3" y1="11" x2="19" y2="11"
        style={{ transition: "opacity 150ms", opacity: open ? 0 : 1 }}
      />
      <line
        x1="3" y1="16" x2="19" y2="16"
        style={{
          transition: "transform 250ms var(--ease-curtain), opacity 200ms var(--ease-quick)",
          transformOrigin: "center",
          transform: open ? "translate(0, -5px) rotate(-45deg)" : "",
        }}
      />
    </svg>
  );
}
