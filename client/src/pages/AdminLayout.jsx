import { NavLink, Navigate, Outlet } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import AppShell from "../components/AppShell.jsx";

/**
 * Shell for every /admin/* page. Renders nothing for non-admins (redirect to
 * /collection) and exposes a sub-nav so admins can pivot between the three
 * surfaces without going back through the global nav.
 */
export default function AdminLayout() {
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/collection" replace />;

  return (
    <AppShell>
      <header className="border-b border-[var(--color-or)]/15 bg-[var(--color-noir-soft)]/40">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <p className="micro">{t("admin.subtitle")}</p>
          <h1 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-1">
            {t("admin.title")}
          </h1>
          <nav className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]">
            <SubLink to="/admin">{t("admin.tab.overview")}</SubLink>
            <SubLink to="/admin/users">{t("admin.tab.users")}</SubLink>
            <SubLink to="/admin/figures">{t("admin.tab.figures")}</SubLink>
            <SubLink to="/admin/catalog">{t("admin.tab.catalog")}</SubLink>
            <SubLink to="/admin/figure-types">{t("admin.tab.figure_types")}</SubLink>
            <SubLink to="/admin/notifications">{t("admin.tab.notifications")}</SubLink>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-10">
        <Outlet />
      </main>
    </AppShell>
  );
}

function SubLink({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === "/admin"}
      className={({ isActive }) =>
        `px-3 py-1.5 transition-colors border-b ${
          isActive
            ? "text-[var(--color-or)] border-[var(--color-or)]"
            : "text-[var(--color-ivoire-soft)] border-transparent hover:text-[var(--color-or-pale)]"
        }`
      }
    >
      {children}
    </NavLink>
  );
}
