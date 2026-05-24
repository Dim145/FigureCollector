import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useUpdateProfile } from "../hooks/useProfile.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";

export default function SettingsPage() {
  const t = useT();
  const me = useMe();
  const update = useUpdateProfile();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const user = me.data.user;
  // /api/me doesn't currently return public_profile_enabled; we keep a derived
  // local mirror via the mutation's last result, falling back to the toggle
  // state (controlled-ish but cheap; full source of truth is the server).
  const flag =
    update.data?.public_profile_enabled ??
    me.data?.user?.public_profile_enabled ??
    false;
  const publicUrl = `${window.location.origin}/u/${user.username}`;

  const toggle = () => update.mutate({ public_profile_enabled: !flag });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      /* ignore */
    }
  };

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <p className="micro">{user.username}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("settings.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        <Card className="p-8">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <h2 className="display text-2xl text-[var(--color-ivoire)]">
                {t("settings.public_profile")}
              </h2>
              <p className="mt-2 text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
                {t("settings.public_profile.body", { username: user.username })}
              </p>
            </div>
            <Toggle on={flag} onChange={toggle} disabled={update.isPending} />
          </div>

          {flag ? (
            <div className="mt-8 border-t border-[var(--color-or)]/15 pt-6">
              <p className="micro mb-2">{t("settings.public_profile.url")}</p>
              <div className="flex items-center gap-2">
                <Link
                  to={`/u/${user.username}`}
                  className="font-mono text-sm text-[var(--color-or)] tracking-wider hover:text-[var(--color-or-pale)] underline-offset-4 hover:underline truncate"
                >
                  {publicUrl}
                </Link>
                <button
                  type="button"
                  onClick={copy}
                  className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
                >
                  {t("settings.copy_url")}
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      </main>
    </AppShell>
  );
}

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      disabled={disabled}
      className={`relative shrink-0 w-12 h-7 transition-colors border ${
        on
          ? "bg-[var(--color-or)] border-[var(--color-or)]"
          : "bg-transparent border-[var(--color-or)]/40"
      } disabled:opacity-60`}
    >
      <span
        className={`absolute top-0.5 ${on ? "left-5" : "left-0.5"} w-5 h-5 transition-all ${
          on ? "bg-[var(--color-noir)]" : "bg-[var(--color-or-pale)]"
        }`}
      />
    </button>
  );
}
