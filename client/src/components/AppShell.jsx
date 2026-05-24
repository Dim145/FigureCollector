import { Link, NavLink, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useLogout, useMe } from "../hooks/useMe.js";
import LocaleSwitcher from "./LocaleSwitcher.jsx";

export default function AppShell({ children }) {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const logout = useLogout();

  const onSignOut = async () => {
    await logout.mutateAsync();
    navigate("/login");
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="relative border-b border-[var(--color-or)]/15 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
          <Link
            to="/"
            className="display text-2xl text-[var(--color-ivoire)] hover:text-[var(--color-or-pale)] transition-colors"
          >
            FigureCollector
          </Link>

          <nav className="flex items-center gap-1 md:gap-4 text-[11px] uppercase tracking-[0.2em]">
            <NavItem to="/collection">{t("nav.collection")}</NavItem>
            <NavItem to="/preorders">{t("nav.preorders")}</NavItem>
            <NavItem to="/browse">{t("nav.browse")}</NavItem>
            <NavItem to="/activity">{t("activity.title")}</NavItem>
            <NavItem to="/figures/new">{t("nav.add_figure")}</NavItem>
            <NavItem to="/settings">{t("nav.settings")}</NavItem>
          </nav>

          <div className="flex items-center gap-4">
            <span
              aria-hidden
              title="⌘K"
              className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] border border-[var(--color-or)]/30 text-[var(--color-or-pale)]"
            >
              {t("palette.hint_open")}
            </span>
            <LocaleSwitcher />
            {me.data?.authenticated ? (
              <button
                type="button"
                onClick={onSignOut}
                className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
              >
                {t("nav.signout")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="gold-rule absolute left-0 right-0 bottom-0 opacity-30" />
      </header>

      <div className="flex-1">{children}</div>
    </div>
  );
}

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-2 py-1 transition-colors ${
          isActive
            ? "text-[var(--color-or)]"
            : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
        }`
      }
    >
      {children}
    </NavLink>
  );
}
