import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  subscribeToWebPush,
  unsubscribeFromWebPush,
  useChannels,
  useRoutes,
  useSaveRoutes,
  useUpdateChannel,
} from "../hooks/useNotifications.js";

/**
 * Notifications settings — appears inside the L'Atelier settings page
 * as two drawers:
 *   - "Canaux" — per-channel enable + destination form
 *   - "Routage" — per-event x per-channel matrix
 *
 * Channel-specific destination fields:
 *   - email        : { to }
 *   - ntfy         : { topic }
 *   - webhook      : { url, auth_header }
 *   - apprise      : { urls (newline-separated) }
 *   - browser_push : handled via the subscribe/unsubscribe SW dance, no
 *                    destination form (the subscription itself IS the dest)
 */

const CHANNEL_META = {
  browser_push: { kanji: "鈴", labelKey: "notif.channel.browser_push" },
  email:        { kanji: "封", labelKey: "notif.channel.email" },
  ntfy:         { kanji: "報", labelKey: "notif.channel.ntfy" },
  webhook:      { kanji: "鉤", labelKey: "notif.channel.webhook" },
  apprise:      { kanji: "音", labelKey: "notif.channel.apprise" },
};

const EVENT_META = {
  achievement_unlocked:     { kanji: "印" },
  preorder_release_today:   { kanji: "予" },
  preorder_release_j7:      { kanji: "近" },
};

export default function NotificationSettings({ t }) {
  return (
    <div className="notif-settings">
      <ChannelsBlock t={t} />
      <RoutingBlock t={t} />
    </div>
  );
}

// =============================================================================
// Channels block
// =============================================================================

function ChannelsBlock({ t }) {
  const channels = useChannels();

  if (channels.isLoading) {
    return <p className="atelier-drawer-desc">…</p>;
  }
  if (!channels.data) return null;

  const { system = [], mine = [] } = channels.data;
  const mineByType = new Map(mine.map((m) => [m.channel_type, m]));

  // The admin-enabled channels come first; admin-disabled appear below as
  // greyed cards.
  const enabled = system.filter((s) => s.enabled);
  const disabled = system.filter((s) => !s.enabled);

  return (
    <div>
      <p className="atelier-drawer-desc">{t("notif.channels.body")}</p>

      <div className="notif-channel-list">
        {enabled.map((ch) => (
          <ChannelCard
            key={ch.channel_type}
            system={ch}
            mine={mineByType.get(ch.channel_type)}
            t={t}
          />
        ))}
        {disabled.length > 0 ? (
          <>
            <p className="notif-channel-disabled-heading">
              {t("notif.channels.disabled_by_admin")}
            </p>
            {disabled.map((ch) => (
              <ChannelCard
                key={ch.channel_type}
                system={ch}
                mine={mineByType.get(ch.channel_type)}
                t={t}
                disabled
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ChannelCard({ system, mine, t, disabled = false }) {
  const meta = CHANNEL_META[system.channel_type] ?? {};
  const update = useUpdateChannel();
  const isEnabled = mine?.enabled ?? false;
  const [editing, setEditing] = useState(false);
  const [destination, setDestination] = useState(mine?.destination ?? {});

  // Re-seed when the server-side state changes underneath us.
  useEffect(() => {
    setDestination(mine?.destination ?? {});
  }, [mine?.destination]);

  const needsDestination = system.channel_type !== "browser_push";
  const hasDestination = needsDestination
    ? destinationFilled(system.channel_type, destination)
    : true;

  const onToggle = () => {
    if (disabled) return;
    update.mutate({
      channel_type: system.channel_type,
      enabled: !isEnabled,
      destination: needsDestination ? destination : undefined,
    });
  };

  const onSaveDest = () => {
    update.mutate(
      {
        channel_type: system.channel_type,
        destination,
      },
      {
        onSuccess: () => setEditing(false),
      },
    );
  };

  return (
    <article
      className={`notif-channel ${disabled ? "is-admin-disabled" : ""} ${
        isEnabled ? "is-user-enabled" : ""
      }`}
    >
      <header className="notif-channel-head">
        <span className="notif-channel-kanji" aria-hidden>
          {meta.kanji}
        </span>
        <div className="notif-channel-title-block">
          <h4 className="notif-channel-title">
            {t(meta.labelKey, { default: system.channel_type })}
          </h4>
          <p className="notif-channel-desc">
            {t(`${meta.labelKey}.body`, { default: "" })}
          </p>
        </div>
        <span className="notif-channel-state">
          {disabled
            ? t("notif.channel.admin_off")
            : isEnabled
              ? t("notif.channel.on")
              : t("notif.channel.off")}
        </span>
        {!disabled ? (
          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            onClick={onToggle}
            disabled={
              update.isPending ||
              (!isEnabled && needsDestination && !hasDestination)
            }
            className={`atelier-toggle ${isEnabled ? "is-on" : ""}`}
            title={
              !isEnabled && needsDestination && !hasDestination
                ? t("notif.channel.fill_destination_first")
                : undefined
            }
          />
        ) : null}
      </header>

      {system.channel_type === "browser_push" && !disabled ? (
        <BrowserPushControls system={system} mine={mine} t={t} />
      ) : null}

      {needsDestination && !disabled ? (
        <div className="notif-channel-body">
          {editing ? (
            <DestinationForm
              channelType={system.channel_type}
              destination={destination}
              onChange={setDestination}
              onSave={onSaveDest}
              onCancel={() => {
                setDestination(mine?.destination ?? {});
                setEditing(false);
              }}
              pending={update.isPending}
              t={t}
            />
          ) : (
            <DestinationSummary
              channelType={system.channel_type}
              destination={destination}
              onEdit={() => setEditing(true)}
              t={t}
            />
          )}
        </div>
      ) : null}
    </article>
  );
}

function destinationFilled(channelType, dest) {
  switch (channelType) {
    case "email":
      return !!dest.to && /@/.test(dest.to);
    case "ntfy":
      return !!dest.topic && dest.topic.trim().length > 0;
    case "webhook":
      return !!dest.url && /^https?:\/\//.test(dest.url);
    case "apprise":
      return Array.isArray(dest.urls)
        ? dest.urls.length > 0
        : typeof dest.urls === "string" && dest.urls.trim().length > 0;
    default:
      return true;
  }
}

function DestinationSummary({ channelType, destination, onEdit, t }) {
  let preview = "";
  switch (channelType) {
    case "email":
      preview = destination.to ?? "";
      break;
    case "ntfy":
      preview = destination.topic ?? "";
      break;
    case "webhook":
      preview = destination.url ?? "";
      break;
    case "apprise":
      preview = Array.isArray(destination.urls)
        ? destination.urls.join(", ")
        : (destination.urls ?? "");
      break;
    default:
      preview = "";
  }
  return (
    <div className="notif-channel-summary">
      {preview ? (
        <span className="notif-channel-summary-value">{preview}</span>
      ) : (
        <span className="notif-channel-summary-empty">
          {t("notif.channel.no_destination")}
        </span>
      )}
      <button
        type="button"
        className="notif-channel-summary-edit"
        onClick={onEdit}
      >
        ✎ {preview ? t("notif.channel.edit") : t("notif.channel.configure")}
      </button>
    </div>
  );
}

function DestinationForm({
  channelType,
  destination,
  onChange,
  onSave,
  onCancel,
  pending,
  t,
}) {
  const inputs = (
    <>
      {channelType === "email" ? (
        <Field
          label={t("notif.channel.email.field.to")}
          hint={t("notif.channel.email.field.to.hint")}
          type="email"
          value={destination.to ?? ""}
          onChange={(v) => onChange({ ...destination, to: v })}
        />
      ) : null}
      {channelType === "ntfy" ? (
        <Field
          label={t("notif.channel.ntfy.field.topic")}
          hint={t("notif.channel.ntfy.field.topic.hint")}
          value={destination.topic ?? ""}
          onChange={(v) => onChange({ ...destination, topic: v })}
        />
      ) : null}
      {channelType === "webhook" ? (
        <>
          <Field
            label={t("notif.channel.webhook.field.url")}
            hint={t("notif.channel.webhook.field.url.hint")}
            type="url"
            value={destination.url ?? ""}
            onChange={(v) => onChange({ ...destination, url: v })}
          />
          <Field
            label={t("notif.channel.webhook.field.auth")}
            hint={t("notif.channel.webhook.field.auth.hint")}
            value={destination.auth_header ?? ""}
            onChange={(v) =>
              onChange({ ...destination, auth_header: v })
            }
          />
        </>
      ) : null}
      {channelType === "apprise" ? (
        <Field
          label={t("notif.channel.apprise.field.urls")}
          hint={t("notif.channel.apprise.field.urls.hint")}
          textarea
          value={
            Array.isArray(destination.urls)
              ? destination.urls.join("\n")
              : (destination.urls ?? "")
          }
          onChange={(v) =>
            onChange({
              ...destination,
              urls: v
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      ) : null}
    </>
  );

  return (
    <div className="notif-channel-form">
      {inputs}
      <div className="notif-channel-form-actions">
        <button
          type="button"
          className="notif-channel-form-btn is-cancel"
          onClick={onCancel}
          disabled={pending}
        >
          {t("editor.cancel")}
        </button>
        <button
          type="button"
          className="notif-channel-form-btn is-save"
          onClick={onSave}
          disabled={pending}
        >
          {t("editor.save")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, type = "text", textarea = false, value, onChange }) {
  return (
    <label className="notif-channel-field">
      <span className="notif-channel-field-label">{label}</span>
      {hint ? <span className="notif-channel-field-hint">{hint}</span> : null}
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="notif-channel-field-input"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="notif-channel-field-input"
        />
      )}
    </label>
  );
}

// =============================================================================
// Browser-push specific subscribe / unsubscribe controls
// =============================================================================

function BrowserPushControls({ system, mine, t }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const update = useUpdateChannel();
  const vapidPublicKey =
    system.config?.vapid_public_key ?? null;
  const isEnabled = mine?.enabled ?? false;

  const subscribed =
    typeof Notification !== "undefined" &&
    Notification.permission === "granted";

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!vapidPublicKey) {
        throw new Error(t("notif.channel.browser_push.no_vapid"));
      }
      await subscribeToWebPush(vapidPublicKey);
      // Flip the user-channel enabled to true now that a sub is registered.
      update.mutate({
        channel_type: "browser_push",
        enabled: true,
        destination: {},
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromWebPush();
      update.mutate({
        channel_type: "browser_push",
        enabled: false,
        destination: {},
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notif-channel-body">
      <p className="notif-channel-field-hint">
        {t("notif.channel.browser_push.hint")}
      </p>
      <div className="notif-channel-form-actions" style={{ justifyContent: "flex-start" }}>
        {!isEnabled || !subscribed ? (
          <button
            type="button"
            className="notif-channel-form-btn is-save"
            onClick={subscribe}
            disabled={busy || !vapidPublicKey}
          >
            🔔 {t("notif.channel.browser_push.subscribe")}
          </button>
        ) : (
          <button
            type="button"
            className="notif-channel-form-btn is-cancel"
            onClick={unsubscribe}
            disabled={busy}
          >
            🔕 {t("notif.channel.browser_push.unsubscribe")}
          </button>
        )}
      </div>
      {error ? (
        <p style={{ color: "var(--color-laque-bright)", marginTop: "0.6rem", fontSize: "0.85rem" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// =============================================================================
// Routing matrix
// =============================================================================

function RoutingBlock({ t }) {
  const routes = useRoutes();
  const save = useSaveRoutes();
  const [local, setLocal] = useState(null);

  useEffect(() => {
    if (routes.data) {
      // Hydrate into a Map { `${event}|${channel}` -> bool } for quick lookups.
      const m = new Map();
      for (const r of routes.data.routes ?? []) {
        m.set(`${r.event_type}|${r.channel_type}`, r.enabled);
      }
      setLocal(m);
    }
  }, [routes.data]);

  if (routes.isLoading || !local) {
    return <p className="atelier-drawer-desc">…</p>;
  }

  const events = routes.data.events ?? [];
  const channels = routes.data.channels ?? [];

  const toggle = (event, channel) => {
    const key = `${event}|${channel}`;
    const next = new Map(local);
    next.set(key, !(local.get(key) ?? true));
    setLocal(next);
  };

  const onSave = () => {
    const updates = [];
    for (const ev of events) {
      for (const ch of channels) {
        const key = `${ev}|${ch}`;
        updates.push({
          event_type: ev,
          channel_type: ch,
          enabled: local.get(key) ?? true,
        });
      }
    }
    save.mutate(updates);
  };

  return (
    <div>
      <p className="atelier-drawer-desc">{t("notif.routes.body")}</p>

      <div className="notif-routes-matrix">
        <div className="notif-routes-head">
          <span />
          {channels.map((ch) => (
            <span key={ch} className="notif-routes-col-head">
              <span className="notif-routes-col-kanji" aria-hidden>
                {CHANNEL_META[ch]?.kanji ?? "?"}
              </span>
              <span className="notif-routes-col-label">
                {t(`${CHANNEL_META[ch]?.labelKey ?? ch}`, { default: ch })}
              </span>
            </span>
          ))}
        </div>
        {events.map((ev) => (
          <div key={ev} className="notif-routes-row">
            <span className="notif-routes-row-head">
              <span className="notif-routes-row-kanji" aria-hidden>
                {EVENT_META[ev]?.kanji ?? "?"}
              </span>
              <span className="notif-routes-row-label">
                {t(`notifications.event.${ev}.title`, {
                  default: ev,
                  label: "—",
                  name: "—",
                  date: "—",
                }).replace(/[:,—].*$/, "")}
              </span>
            </span>
            {channels.map((ch) => {
              const key = `${ev}|${ch}`;
              const on = local.get(key) ?? true;
              return (
                <button
                  key={ch}
                  type="button"
                  className={`notif-routes-cell ${on ? "is-on" : ""}`}
                  onClick={() => toggle(ev, ch)}
                  aria-pressed={on}
                >
                  {on ? "✓" : "—"}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="notif-channel-form-actions" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="notif-channel-form-btn is-save"
          onClick={onSave}
          disabled={save.isPending}
        >
          {t("notif.routes.save")}
        </button>
      </div>
    </div>
  );
}

// Unused export to silence missing import warnings.
export const __notif_meta = { CHANNEL_META, EVENT_META };
// eslint-disable-next-line no-unused-vars
const _useMemoShim = useMemo;
