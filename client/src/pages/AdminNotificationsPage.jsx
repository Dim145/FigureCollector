import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminChannels,
  useAdminUpdateChannel,
  useGenerateVapid,
} from "../hooks/useNotifications.js";
import { KeyRound } from "lucide-react";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FormField from "../components/FormField.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

/**
 * Admin · Notifications channels — redrawn to Direction A ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * sub-nav already sit above. This view is therefore an editorial *section* of
 * the admin surface (kicker · 鈴 · label → AccentTitle h2 → gold-rule → italic
 * gloss over a faint kanji-mark) rather than a second page header.
 *
 * Below it, the five delivery channels (browser_push, email, ntfy, webhook,
 * apprise) each become a Direction-A `Card` panel — mirroring SettingsPage:
 * a kanji + kicker sub-label and a gold-rule divider introduce each channel,
 * an A toggle row flips it on/off, the system-level secrets (SMTP credentials,
 * VAPID keys, ntfy server URL + bearer, Apprise sidecar URL, …) are A form
 * controls (shared `FormField` / textarea / checkbox row), and a hanko-red
 * primary `Button` saves them. Toggling without a valid config disables the
 * channel system-wide; only after the admin saves config CAN they flip it on.
 *
 * Data + behaviour are unchanged: the `useAdminChannels` query and the
 * `useAdminUpdateChannel` / `useGenerateVapid` mutations drive everything, the
 * VAPID overwrite confirm + dirty-tracking are intact. GPU-light throughout —
 * flat fills, hairlines, the shared `.reveal` stagger, no meshes / blur.
 */

// Channel structure only — display strings (name/body, field labels/hints)
// live in i18n under `admin.notif.ch.<type>.*` and `admin.notif.f.<type>.<key>.*`.
// `hint: true` marks fields that have a `.hint` translation to render.
// `kanji` doubles as the panel's editorial section marker (Direction A touch).
const CHANNEL_META = {
  browser_push: {
    kanji: "鈴",
    fields: [
      { key: "vapid_public_key", type: "text", hint: true },
      { key: "vapid_private_key", type: "textarea", hint: true },
      { key: "vapid_subject", type: "text", hint: true },
    ],
  },
  email: {
    kanji: "封",
    fields: [
      { key: "host", type: "text" },
      { key: "port", type: "number", default: 587 },
      { key: "use_tls", type: "bool" },
      { key: "username", type: "text" },
      { key: "password", type: "password" },
      { key: "from", type: "text", hint: true },
    ],
  },
  ntfy: {
    kanji: "報",
    fields: [
      { key: "server_url", type: "text", default: "https://ntfy.sh" },
      { key: "auth_header", type: "text", hint: true },
    ],
  },
  webhook: {
    kanji: "鉤",
    fields: [],
  },
  apprise: {
    kanji: "音",
    fields: [
      { key: "server_url", type: "text", hint: true },
      { key: "auth_header", type: "text" },
    ],
  },
};

export default function AdminNotificationsPage() {
  const t = useT();
  const list = useAdminChannels();

  if (list.isLoading) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="text-center text-[var(--color-ivoire-soft)] py-12"
      >
        …
      </p>
    );
  }
  if (!list.data) return null;

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-10">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] -top-24 -right-6 hidden md:block select-none"
        >
          鈴
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span
            aria-hidden
            className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          />
          {t("admin.notif.subtitle")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            鈴
          </span>
          {t("admin.notif.kicker_label", { default: "CANAUX" })}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.notif.title")} />
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="display-italic text-[var(--color-or)] text-base md:text-lg mt-4 max-w-2xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.notif.body")}
        </p>
      </header>

      {/* ─── Channel config panels ─── */}
      <div className="space-y-8">
        {list.data.map((ch) => (
          <AdminChannelCard key={ch.channel_type} channel={ch} t={t} />
        ))}
      </div>

    </div>
  );
}

function AdminChannelCard({ channel, t }) {
  const meta = CHANNEL_META[channel.channel_type] ?? { kanji: "?", fields: [] };
  const update = useAdminUpdateChannel();
  const generateVapid = useGenerateVapid();
  const [config, setConfig] = useState(channel.config ?? {});
  const [dirty, setDirty] = useState(false);
  const [vapidNotice, setVapidNotice] = useState(null);
  // True while the "overwrite existing VAPID keypair?" dialog is open.
  // Replaces a `window.confirm()` — same UX, but styled + focus-trapped.
  const [vapidOverwriteOpen, setVapidOverwriteOpen] = useState(false);

  useEffect(() => {
    setConfig(channel.config ?? {});
    setDirty(false);
  }, [channel.config]);

  const onChange = (key, value) => {
    setConfig({ ...config, [key]: value });
    setDirty(true);
  };

  /** Mint a new VAPID keypair, drop the values into the form fields, and
   *  flag the form as dirty. Existing keys (if any) are overwritten — we
   *  warn first since users with active push subscriptions will need to
   *  re-subscribe after a key rotation. */
  const runGenerateVapid = () => {
    generateVapid.mutate(undefined, {
      onSuccess: (data) => {
        setConfig({
          ...config,
          vapid_public_key: data.public_key,
          vapid_private_key: data.private_key,
          // Seed the subject with a sensible mailto: default unless the
          // admin already set one — VAPID requires a `sub` claim.
          vapid_subject:
            config.vapid_subject ?? "mailto:admin@figurecollector.local",
        });
        setDirty(true);
        setVapidNotice(t("admin.notif.vapid.generated_save"));
      },
      onError: (err) => {
        setVapidNotice(`✗ ${err?.message ?? t("admin.notif.vapid.generate_failed")}`);
      },
    });
  };

  const onGenerateVapid = () => {
    const hasExisting =
      !!config.vapid_public_key || !!config.vapid_private_key;
    if (hasExisting) {
      // Defer the actual mutation until the confirmation dialog accepts.
      setVapidOverwriteOpen(true);
      return;
    }
    runGenerateVapid();
  };

  const onToggle = () => {
    update.mutate({
      channel_type: channel.channel_type,
      enabled: !channel.enabled,
    });
  };

  const onSave = () => {
    update.mutate(
      {
        channel_type: channel.channel_type,
        config,
      },
      { onSuccess: () => setDirty(false) },
    );
  };

  const name = t(`admin.notif.ch.${channel.channel_type}.name`, {
    default: channel.channel_type,
  });
  const desc = t(`admin.notif.ch.${channel.channel_type}.body`, { default: "" });
  const noticeIsError = (vapidNotice ?? "").startsWith("✗");

  return (
    <Panel
      kanji={meta.kanji}
      eyebrow={t("admin.notif.channel_kicker", { default: "CANAL DE DIFFUSION" })}
      title={name}
      idTag={channel.channel_type}
      enabled={channel.enabled}
    >
      {desc ? <p className="atelier-drawer-desc">{desc}</p> : null}

      {/* System-enable toggle — mirrors SettingsPage's A toggle row. */}
      <div className="atelier-toggle-row">
        <div
          id={`notif-ch-state-${channel.channel_type}`}
          className="atelier-toggle-row-text"
        >
          <span
            className={`atelier-toggle-row-state ${channel.enabled ? "is-on" : ""}`}
          >
            {channel.enabled
              ? t("notif.channel.on")
              : t("notif.channel.off")}
          </span>
          <span className="atelier-toggle-row-hint">
            {t("admin.notif.system_enable", { default: "Disponible pour tous les utilisateurs" })}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={channel.enabled}
          aria-labelledby={`notif-ch-state-${channel.channel_type}`}
          onClick={onToggle}
          disabled={update.isPending}
          className={`atelier-toggle ${channel.enabled ? "is-on" : ""}`}
        />
      </div>

      {meta.fields.length > 0 ? (
        <>
          <div className="gold-rule w-12 mt-6 mb-6" />

          {channel.channel_type === "browser_push" ? (
            <div
              className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 p-4 border"
              style={{
                borderColor: "color-mix(in oklab, var(--color-or) 20%, transparent)",
                background: "color-mix(in oklab, var(--color-noir-deep) 50%, transparent)",
              }}
            >
              <Button
                variant="primary"
                onClick={onGenerateVapid}
                loading={generateVapid.isPending}
                className="shrink-0"
              >
                {generateVapid.isPending ? (
                  t("admin.notif.vapid.generating")
                ) : (
                  <>
                    <KeyRound size={16} strokeWidth={1.75} aria-hidden />{" "}
                    {t("admin.notif.vapid.generate")}
                  </>
                )}
              </Button>
              <p className="flex-1 min-w-[16rem] text-xs text-[var(--color-ivoire-soft)] leading-relaxed">
                {t("admin.notif.vapid.hint")}
              </p>
              {vapidNotice ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="basis-full text-xs tracking-wide"
                  style={{
                    color: noticeIsError
                      ? "var(--color-laque-bright)"
                      : "var(--color-or)",
                  }}
                >
                  {vapidNotice}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-5">
            {meta.fields.map((f) => (
              <ConfigField
                key={f.key}
                field={f}
                channelType={channel.channel_type}
                t={t}
                value={config[f.key]}
                onChange={(v) => onChange(f.key, v)}
              />
            ))}
            <div className="flex justify-end pt-1">
              <Button
                variant="primary"
                onClick={onSave}
                disabled={!dirty || update.isPending}
                loading={update.isPending}
              >
                {t("admin.notif.save")}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={vapidOverwriteOpen}
        title={t("admin.notif.vapid.generate")}
        body={t("admin.notif.vapid.confirm_overwrite")}
        destructive
        busy={generateVapid.isPending}
        onCancel={() => setVapidOverwriteOpen(false)}
        onConfirm={() => {
          setVapidOverwriteOpen(false);
          runGenerateVapid();
        }}
      />
    </Panel>
  );
}

function ConfigField({ field, channelType, value, onChange, t }) {
  const label = t(`admin.notif.f.${channelType}.${field.key}.label`, {
    default: field.key,
  });
  const hint = field.hint
    ? t(`admin.notif.f.${channelType}.${field.key}.hint`)
    : null;

  // Boolean → A checkbox row (gold rim, hanko-red when checked), echoing the
  // SettingsPage toggle-row text/hint stack on the right of the control.
  if (field.type === "bool") {
    return (
      <label className="flex items-center gap-3 cursor-pointer tap-target">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-[var(--color-laque-bright)]"
          style={{ accentColor: "var(--color-laque-bright)" }}
        />
        <span className="text-sm text-[var(--color-ivoire)]">{label}</span>
      </label>
    );
  }

  // Multi-line secret (VAPID private key PEM) → a textarea matching the
  // shared FormField input chrome (noir well, gold rim, focus → gold).
  if (field.type === "textarea") {
    return (
      <label className="block">
        <span className="micro block mb-2">{label}</span>
        <textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none transition-colors duration-200 focus:border-[var(--color-or)] resize-y"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.01em",
          }}
        />
        {hint ? (
          <span className="mt-1.5 block text-xs text-[var(--color-ivoire-soft)] tracking-wide">
            {hint}
          </span>
        ) : null}
      </label>
    );
  }

  // text / number / password → shared FormField (Direction A input chrome).
  return (
    <FormField
      label={label}
      hint={hint ?? undefined}
      type={field.type}
      value={value ?? field.default ?? ""}
      onChange={(v) =>
        onChange(field.type === "number" ? Number(v) : v)
      }
    />
  );
}

// =============================================================================
// Panel — one channel's config, as a Direction-A Card with an editorial header.
// Mirrors SettingsPage's Panel so the admin surface reads in the same language:
// a faint kanji watermark, a kanji + kicker sub-label, a gold-rule divider. The
// channel's enabled state lights the kanji + an "active" dot in hanko-red.
// =============================================================================

function Panel({ kanji, eyebrow, title, idTag, enabled = false, children }) {
  return (
    <Card
      as="section"
      className="relative overflow-hidden p-6 md:p-8 reveal"
    >
      {/* Calm kanji watermark — gold (or hanko-red once the channel is live),
          very faint, bleeding off the corner. Static, pointer-inert. */}
      <span
        aria-hidden
        className="kanji-mark text-[11rem] -top-10 -right-4 select-none transition-colors"
        style={
          enabled
            ? { color: "color-mix(in oklab, var(--color-laque) 14%, transparent)" }
            : undefined
        }
      >
        {kanji}
      </span>

      <header className="relative mb-6">
        <p className="micro flex items-center gap-2">
          <span
            aria-hidden
            className="ja not-italic text-base leading-none transition-colors"
            style={{
              color: enabled
                ? "var(--color-laque-bright)"
                : "var(--color-or)",
            }}
          >
            {kanji}
          </span>
          {eyebrow}
          {enabled ? (
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-[var(--color-laque-bright)]"
              style={{ boxShadow: "0 0 8px var(--color-laque-bright)" }}
            />
          ) : null}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="display text-2xl md:text-3xl text-[var(--color-ivoire)] leading-tight">
            {title}
          </h3>
          {idTag ? (
            <code className="label-mono" style={{ textTransform: "none" }}>
              {idTag}
            </code>
          ) : null}
        </div>
        <div className="gold-rule w-16 mt-4" />
      </header>
      <div className="relative">{children}</div>
    </Card>
  );
}
