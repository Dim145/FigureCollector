import { NavLink, Navigate, Outlet } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import AppShell from "../components/AppShell.jsx";
import AccentTitle from "../components/AccentTitle.jsx";

/**
 * Shell for every /admin/* page — redrawn to Direction A ("Shōjo-Noir") on the
 * shared foundation's *semantic* tokens (--surface / --border / --on-surface,
 * active = --primary) so the chrome follows the dark/light theme for free.
 *
 * The admin console is data-dense, so the chrome stays efficient: an editorial
 * header (kicker · 管 · label → AccentTitle h1 → gold-rule, over a faint
 * kanji-mark watermark) introduces the surface, and a kanji-marked admin nav
 * pivots between the eleven sub-surfaces. On lg+ the nav is a sticky left rail
 * with a --primary active marker (left border + diamond, echoing AppShell's
 * NavItem + SettingsPage's section index); below that it folds into a
 * horizontal scroll rail so the bar never crowds the content.
 *
 * The <Outlet/> sits in a quiet well to the right (or below on mobile) — each
 * admin page renders its own per-page sub-header inside it, so the layout
 * deliberately does NOT repeat a title there.
 *
 * Direction A keeps the chrome calm: flat fills + hairlines, the shared
 * `.reveal` stagger, gold for rules and --primary for the single hot accent.
 * Auth/admin guards, routes, labels and the <Outlet/> are unchanged.
 */

// Nav identity: route + label key + a kanji marker driving the visual accent.
// Order here is the order the rail renders. `end` mirrors the old SubLink
// behaviour (only the index route matches exactly). Kanji chosen per surface:
//   概 overview · 衆 users · 像 figures · 目 entities · 類 types · 店 stores ·
//   漫 manga servers · 鈴 notifications · 工 workers · 務 tasks · 設 settings.
const NAV = [
  { to: "/admin", kanji: "概", key: "admin.tab.overview", end: true },
  { to: "/admin/users", kanji: "衆", key: "admin.tab.users" },
  { to: "/admin/figures", kanji: "像", key: "admin.tab.figures" },
  { to: "/admin/catalog", kanji: "目", key: "admin.tab.catalog" },
  { to: "/admin/figure-types", kanji: "類", key: "admin.tab.figure_types" },
  { to: "/admin/stores", kanji: "店", key: "admin.tab.stores" },
  { to: "/admin/manga-servers", kanji: "漫", key: "admin.tab.manga_servers" },
  { to: "/admin/notifications", kanji: "鈴", key: "admin.tab.notifications" },
  { to: "/admin/workers", kanji: "工", key: "admin.tab.workers" },
  { to: "/admin/tasks", kanji: "務", key: "admin.tab.tasks" },
  { to: "/admin/settings", kanji: "設", key: "admin.tab.settings" },
];

export default function AdminLayout() {
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/collection" replace />;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 md:py-16">
        {/* ─── Editorial header ─── */}
        <header className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[22rem] -top-24 -right-6 hidden md:block select-none"
          >
            管
          </span>

          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span aria-hidden className="w-1 h-1 bg-[var(--primary)] rotate-45" />
            {t("admin.kicker", { default: "ADMINISTRATION" })}
            <span aria-hidden className="ja not-italic text-[var(--accent)]">
              管
            </span>
            {t("admin.kicker_label", { default: "CONSOLE" })}
          </p>
          <h1
            className="display text-5xl md:text-6xl mt-3 text-[var(--on-surface)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("admin.title")} />
          </h1>
          <div className="gold-rule w-32 mt-5 reveal" style={{ "--i": 2 }} />
          <p
            className="display-italic text-[var(--accent)] text-base md:text-lg mt-4 max-w-xl reveal"
            style={{ "--i": 3 }}
          >
            {t("admin.subtitle")}
          </p>
        </header>

        {/* ─── Admin nav rail (sticky on lg) + Outlet surface ─── */}
        <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-10 lg:items-start">
          <AdminNav t={t} />

          {/* The shared content well. Sub-pages bring their own sub-headers,
              so this is just a calm surface that frames them. `min-w-0` lets
              dense tables/grids inside scroll instead of blowing out the grid
              track. */}
          <section
            className="min-w-0 relative border-t border-[var(--border-subtle)] pt-8 lg:border-t-0 lg:pt-0"
            aria-label={t("admin.console.region", { default: "Console d’administration" })}
          >
            <Outlet />
          </section>
        </div>
      </main>
    </AppShell>
  );
}

// =============================================================================
// Admin nav — sticky vertical rail on desktop, horizontal scroll rail on mobile
// =============================================================================

function AdminNav({ t }) {
  return (
    <nav
      className="lg:sticky lg:top-24 mb-8 lg:mb-0"
      aria-label={t("admin.nav.heading", { default: "Sections d’administration" })}
    >
      <p className="micro pb-3 mb-2 border-b border-[var(--border)] hidden lg:block">
        {t("admin.nav.heading", { default: "Sections d’administration" })}
      </p>
      <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible">
        {NAV.map((it, i) => (
          <li key={it.to} className="reveal shrink-0 lg:shrink" style={{ "--i": i }}>
            <NavItem to={it.to} end={it.end} kanji={it.kanji}>
              {t(it.key)}
            </NavItem>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// One rail entry. Renders as a real NavLink (keyboard-navigable, focusable),
// sets aria-current on the active route, and marks the active state in
// --primary: a left border + a small rotated diamond (echoing AppShell's
// NavItem). The kanji glyph shifts gold → --primary when active.
function NavItem({ to, end, kanji, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `tap-target group relative flex items-center gap-2.5 whitespace-nowrap px-3 lg:px-3 lg:py-2.5 lg:border-l-2 transition-colors focus:outline-none focus-visible:text-[var(--accent)] ${
          isActive
            ? "text-[var(--on-surface)]"
            : "text-[var(--on-surface-muted)] hover:text-[var(--on-surface)]"
        }`
      }
      style={({ isActive }) => ({
        borderLeftColor: isActive ? "var(--primary)" : "transparent",
      })}
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className="ja text-base leading-none transition-colors"
            style={{
              color: isActive ? "var(--primary)" : "var(--accent)",
              opacity: isActive ? 1 : 0.55,
            }}
          >
            {kanji}
          </span>
          <span className="text-[11px] uppercase tracking-[0.2em] lg:text-[12px] lg:tracking-[0.16em] lg:normal-case">
            {children}
          </span>
          {isActive ? (
            <span
              aria-hidden
              className="ml-auto hidden lg:block w-1 h-1 bg-[var(--primary)] rotate-45 shrink-0"
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}
