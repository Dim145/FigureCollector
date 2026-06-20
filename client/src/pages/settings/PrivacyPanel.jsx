import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Link2 } from "lucide-react";
import { useT } from "../../i18n/index.jsx";
import { useUpdateProfile } from "../../hooks/useProfile.js";
import SettingsPanel from "./SettingsPanel.jsx";
import Switch from "../../components/ui/Switch.jsx";
import Button from "../../components/Button.jsx";

// NSFW visibility choices, each with its own kanji glyph (覆 cover, 霞 mist,
// 開 open) driving the option-card identity.
const NSFW_OPTIONS = [
  { key: "hide", kanji: "覆" },
  { key: "blur", kanji: "霞" },
  { key: "show", kanji: "開" },
];

/**
 * 禁 Confidentialité — everything privacy-shaped, folded into one panel:
 *   1. public profile on/off + sharable URL (copy) + the two sub-toggles
 *      (expose NSFW / expose value) that only matter once it's public;
 *   2. the NSFW visibility selector for the user's *own* browsing.
 *
 * All writes go through the existing `useUpdateProfile` mutation; the panel owns
 * its save (optimistic value comes from `update.data` falling back to `user`).
 * Toggles are the shared {@link Switch} (role=switch, a11y handled) — no more
 * page-local `atelier-toggle`.
 */
export default function PrivacyPanel({ user, registerRef }) {
  const t = useT();
  const update = useUpdateProfile();
  const [copied, setCopied] = useState(false);

  const val = (k, fallback) => update.data?.[k] ?? user?.[k] ?? fallback;
  const enabled = val("public_profile_enabled", false);
  const showNsfw = val("public_profile_show_nsfw", false);
  const showValue = val("public_profile_show_value", false);
  const nsfwVisibility = val("nsfw_visibility", "hide");
  const publicUrl = `${window.location.origin}/u/${user.username}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <SettingsPanel
      id="privacy"
      kanji="禁"
      eyebrow={t("settings.nav.privacy", { default: "Confidentialité" })}
      title={t("settings.privacy.title", { default: "Confidentialité" })}
      registerRef={registerRef}
    >
      {/* ── Public profile ── */}
      <p className="text-sm leading-relaxed text-[var(--on-surface-muted)]">
        {t("settings.public_profile.body", { username: user.username })}
      </p>

      <div className="mt-4 py-4 border-t border-[var(--border-subtle)]">
        <Switch
          checked={enabled}
          disabled={update.isPending}
          onChange={() => update.mutate({ public_profile_enabled: !enabled })}
          label={t("settings.public_profile")}
          hint={`/u/${user.username}`}
        />
      </div>

      {enabled ? (
        <>
          {/* Sharable URL + copy */}
          <div className="flex items-center justify-between gap-3 flex-wrap p-3 border border-[var(--border)] bg-[var(--surface-sunken)]">
            <span className="min-w-0">
              <span className="micro block mb-1">{t("settings.public_profile.url")}</span>
              <Link
                to={`/u/${user.username}`}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline break-all"
              >
                <Link2 size={14} strokeWidth={1.75} className="shrink-0" />
                {publicUrl}
              </Link>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              iconStart={copied ? <Check size={14} /> : <Copy size={14} />}
            >
              {copied ? t("settings.copy_url.done") : t("settings.copy_url")}
            </Button>
          </div>

          {/* Sub-toggle — expose NSFW pieces on the public profile (OFF by
              default; the conservative choice). */}
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <Switch
              checked={showNsfw}
              disabled={update.isPending}
              onChange={() => update.mutate({ public_profile_show_nsfw: !showNsfw })}
              label={t("settings.public_profile.show_nsfw")}
              hint={t("settings.public_profile.show_nsfw.body")}
            />
          </div>

          {/* Sub-toggle — expose collection value (La Cote) publicly (OFF by
              default so a public profile never leaks value unintentionally). */}
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <Switch
              checked={showValue}
              disabled={update.isPending}
              onChange={() => update.mutate({ public_profile_show_value: !showValue })}
              label={t("settings.public_profile.show_value")}
              hint={t("settings.public_profile.show_value.body")}
            />
          </div>
        </>
      ) : null}

      {/* ── NSFW visibility (own browsing) ── */}
      <div className="mt-8 pt-6 border-t border-[var(--border)]">
        <p className="micro mb-2">{t("settings.nsfw.title")}</p>
        <p className="text-sm leading-relaxed text-[var(--on-surface-muted)] mb-4">
          {t("settings.nsfw.body")}
        </p>
        <div
          role="radiogroup"
          aria-label={t("settings.nsfw.title")}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {NSFW_OPTIONS.map(({ key, kanji }) => {
            const isActive = nsfwVisibility === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => update.mutate({ nsfw_visibility: key })}
                disabled={update.isPending}
                className="tap-target relative text-left p-4 border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60 disabled:cursor-wait"
                style={{
                  borderColor: isActive ? "var(--primary)" : "var(--border)",
                  background: isActive
                    ? "var(--primary-surface, color-mix(in oklab, var(--primary) 10%, transparent))"
                    : "var(--surface-sunken)",
                }}
              >
                <span
                  aria-hidden
                  className="ja block text-2xl leading-none mb-2"
                  style={{
                    color: isActive ? "var(--primary)" : "var(--accent)",
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  {kanji}
                </span>
                <span className="display text-lg block leading-tight text-[var(--on-surface)]">
                  {t(`settings.nsfw.${key}.title`)}
                </span>
                <span className="block mt-1.5 text-xs leading-relaxed text-[var(--on-surface-muted)]">
                  {t(`settings.nsfw.${key}.body`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SettingsPanel>
  );
}
