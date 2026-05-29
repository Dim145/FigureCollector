import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminChannels,
  useAdminUpdateChannel,
  useGenerateVapid,
} from "../hooks/useNotifications.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

/**
 * Admin · Notifications channels.
 *
 * Five cards (browser_push, email, ntfy, webhook, apprise) — each
 * showing whether it's system-enabled + a form to edit the system-level
 * secrets (SMTP credentials, VAPID keys, ntfy server URL + bearer,
 * Apprise sidecar URL, etc.). Toggling without a valid config disables
 * the channel system-wide; only after the admin saves config CAN they
 * flip it on.
 */

// Channel structure only — display strings (name/body, field labels/hints)
// live in i18n under `admin.notif.ch.<type>.*` and `admin.notif.f.<type>.<key>.*`.
// `hint: true` marks fields that have a `.hint` translation to render.
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

  if (list.isLoading) return <p className="text-[var(--color-ivoire-soft)]">…</p>;
  if (!list.data) return null;

  return (
    <div>
      <header className="mb-6">
        <p className="micro">{t("admin.notif.subtitle")}</p>
        <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
          {t("admin.notif.title")}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {t("admin.notif.body")}
        </p>
      </header>

      <div className="notif-channel-list">
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

  return (
    <article className={`notif-channel ${channel.enabled ? "is-user-enabled" : ""}`}>
      <header className="notif-channel-head">
        <span className="notif-channel-kanji" aria-hidden>
          {meta.kanji}
        </span>
        <div className="notif-channel-title-block">
          <h3 className="notif-channel-title">
            {t(`admin.notif.ch.${channel.channel_type}.name`, {
              default: channel.channel_type,
            })}
          </h3>
          <p className="notif-channel-desc">
            {t(`admin.notif.ch.${channel.channel_type}.body`, { default: "" })}
          </p>
        </div>
        <span className="notif-channel-state">
          {channel.enabled
            ? t("notif.channel.on")
            : t("notif.channel.off")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={channel.enabled}
          onClick={onToggle}
          disabled={update.isPending}
          className={`atelier-toggle ${channel.enabled ? "is-on" : ""}`}
        />
      </header>

      {meta.fields.length > 0 ? (
        <div className="notif-channel-body">
          {channel.channel_type === "browser_push" ? (
            <div className="notif-vapid-toolbar">
              <button
                type="button"
                className="notif-channel-form-btn is-save"
                onClick={onGenerateVapid}
                disabled={generateVapid.isPending}
              >
                {generateVapid.isPending
                  ? t("admin.notif.vapid.generating")
                  : <><span aria-hidden>🔑</span> {t("admin.notif.vapid.generate")}</>}
              </button>
              <p className="notif-vapid-hint">
                {t("admin.notif.vapid.hint")}
              </p>
              {vapidNotice ? (
                <p className="notif-vapid-notice">{vapidNotice}</p>
              ) : null}
            </div>
          ) : null}
          <div className="notif-channel-form">
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
            <div className="notif-channel-form-actions">
              <button
                type="button"
                className="notif-channel-form-btn is-save"
                onClick={onSave}
                disabled={!dirty || update.isPending}
              >
                {t("admin.notif.save")}
              </button>
            </div>
          </div>
        </div>
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
    </article>
  );
}

function ConfigField({ field, channelType, value, onChange, t }) {
  const label = t(`admin.notif.f.${channelType}.${field.key}.label`, {
    default: field.key,
  });
  const hint = field.hint
    ? t(`admin.notif.f.${channelType}.${field.key}.hint`)
    : null;
  if (field.type === "bool") {
    return (
      <label className="notif-channel-field flex-row items-center gap-3">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="notif-channel-field-label flex-1">{label}</span>
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="notif-channel-field">
        <span className="notif-channel-field-label">{label}</span>
        {hint ? <span className="notif-channel-field-hint">{hint}</span> : null}
        <textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="notif-channel-field-input"
        />
      </label>
    );
  }
  return (
    <label className="notif-channel-field">
      <span className="notif-channel-field-label">{label}</span>
      {hint ? <span className="notif-channel-field-hint">{hint}</span> : null}
      <input
        type={field.type}
        value={value ?? field.default ?? ""}
        onChange={(e) =>
          onChange(
            field.type === "number" ? Number(e.target.value) : e.target.value,
          )
        }
        className="notif-channel-field-input"
      />
    </label>
  );
}
