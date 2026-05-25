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

const CHANNEL_META = {
  browser_push: {
    kanji: "鈴",
    label: "Browser (Web Push)",
    body: "VAPID-signed Web Push to subscribed browsers + devices.",
    fields: [
      { key: "vapid_public_key", label: "VAPID public key", type: "text",
        hint: "Base64url ECDSA P-256 public key the SPA passes to pushManager.subscribe." },
      { key: "vapid_private_key", label: "VAPID private key (PEM)", type: "textarea",
        hint: "PEM-encoded EC private key. Generate with web-push-cli or any VAPID generator." },
      { key: "vapid_subject", label: "VAPID subject", type: "text",
        hint: "mailto:admin@your-domain or https://your-domain — required by push services." },
    ],
  },
  email: {
    kanji: "封",
    label: "Email (SMTP)",
    body: "Outbound email via the SMTP server credentials below.",
    fields: [
      { key: "host", label: "SMTP host", type: "text" },
      { key: "port", label: "Port", type: "number", default: 587 },
      { key: "use_tls", label: "Use TLS (port 465)", type: "bool" },
      { key: "username", label: "Username (optional)", type: "text" },
      { key: "password", label: "Password / app password", type: "password" },
      { key: "from", label: "From address", type: "text",
        hint: 'e.g. "FigureCollector <noreply@your-domain>".' },
    ],
  },
  ntfy: {
    kanji: "報",
    label: "ntfy",
    body: "ntfy.sh or self-hosted instance.",
    fields: [
      { key: "server_url", label: "Server URL", type: "text", default: "https://ntfy.sh" },
      { key: "auth_header", label: "Authorization header (optional)", type: "text",
        hint: 'e.g. "Bearer tk_…" for protected topics.' },
    ],
  },
  webhook: {
    kanji: "鉤",
    label: "Webhook",
    body: "No system config — each user supplies their own URL.",
    fields: [],
  },
  apprise: {
    kanji: "音",
    label: "Apprise",
    body: "Apprise sidecar that fans out to 100+ services.",
    fields: [
      { key: "server_url", label: "Apprise server URL", type: "text",
        hint: 'e.g. "http://apprise:8000".' },
      { key: "auth_header", label: "Authorization header (optional)", type: "text" },
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
  const meta = CHANNEL_META[channel.channel_type] ?? {
    kanji: "?",
    label: channel.channel_type,
    body: "",
    fields: [],
  };
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
        setVapidNotice(`✗ ${err?.message ?? "Generation failed"}`);
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
          <h3 className="notif-channel-title">{meta.label}</h3>
          <p className="notif-channel-desc">{meta.body}</p>
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
                  : `🔑 ${t("admin.notif.vapid.generate")}`}
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

function ConfigField({ field, value, onChange }) {
  if (field.type === "bool") {
    return (
      <label className="notif-channel-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.85rem" }}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="notif-channel-field-label" style={{ flex: 1 }}>
          {field.label}
        </span>
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="notif-channel-field">
        <span className="notif-channel-field-label">{field.label}</span>
        {field.hint ? <span className="notif-channel-field-hint">{field.hint}</span> : null}
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
      <span className="notif-channel-field-label">{field.label}</span>
      {field.hint ? <span className="notif-channel-field-hint">{field.hint}</span> : null}
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
