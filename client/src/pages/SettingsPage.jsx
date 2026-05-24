import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useUpdateProfile } from "../hooks/useProfile.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import Select from "../components/Select.jsx";
import { BG_MODEL_SIZES, getPref, setPref } from "../lib/userPrefs.js";

export default function SettingsPage() {
  const t = useT();
  const me = useMe();
  const update = useUpdateProfile();
  const [bgModel, setBgModel] = useState(() => getPref("bgModel"));

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const user = me.data.user;
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

  const onBgModel = (value) => {
    setBgModel(value);
    setPref("bgModel", value);
  };

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-6 py-12 space-y-6">
        <header className="text-center mb-4">
          <p className="micro">{user.username}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("settings.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        {/* ---- Public profile -------------------------------------- */}
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

        {/* ---- Background-removal model size ----------------------- */}
        <Card className="p-8">
          <h2 className="display text-2xl text-[var(--color-ivoire)]">
            {t("settings.bg_model")}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
            {t("settings.bg_model.body")}
          </p>
          <div className="mt-5 max-w-xs">
            <Select
              label={t("settings.bg_model")}
              value={bgModel}
              onChange={onBgModel}
              options={BG_MODEL_SIZES.map((size) => ({
                value: size,
                label: t(`settings.bg_model.${size}`),
              }))}
            />
          </div>
          <p className="mt-3 text-xs text-[var(--color-ivoire-soft)]/70">
            {t("settings.bg_model.hint")}
          </p>
        </Card>

        {/* ---- NSFW visibility ------------------------------------ */}
        <Card className="p-8">
          <h2 className="display text-2xl text-[var(--color-ivoire)]">
            {t("settings.nsfw.title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
            {t("settings.nsfw.body")}
          </p>

          <div className="mt-5 grid sm:grid-cols-3 gap-3">
            {["hide", "blur", "show"].map((opt) => {
              const current =
                update.data?.nsfw_visibility ?? user.nsfw_visibility ?? "hide";
              const active = current === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => update.mutate({ nsfw_visibility: opt })}
                  disabled={update.isPending}
                  aria-pressed={active}
                  className={`p-4 text-left border transition-all ${
                    active
                      ? "border-[var(--color-or)] bg-[var(--color-or)]/10"
                      : "border-[var(--color-or)]/15 hover:border-[var(--color-or)]/50"
                  } disabled:opacity-50`}
                  style={
                    active
                      ? {
                          boxShadow:
                            "0 0 0 1px var(--color-or), 0 10px 25px -10px rgba(0,0,0,0.6)",
                        }
                      : undefined
                  }
                >
                  <p
                    className={`display text-lg ${
                      active ? "text-[var(--color-or)]" : "text-[var(--color-ivoire)]"
                    }`}
                  >
                    {t(`settings.nsfw.${opt}.title`)}
                  </p>
                  <p className="text-xs text-[var(--color-ivoire-soft)] mt-2 leading-relaxed">
                    {t(`settings.nsfw.${opt}.body`)}
                  </p>
                </button>
              );
            })}
          </div>
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
