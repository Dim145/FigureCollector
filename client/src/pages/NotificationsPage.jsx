import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotificationCounts,
  useNotificationRealtime,
  useNotifications,
} from "../hooks/useNotifications.js";
import AppShell from "../components/AppShell.jsx";
import { formatNotification } from "../lib/notificationMessages.js";

/**
 * /notifications — the boîte de réception.
 *
 * Two tabs: unread + all. Click a row to follow its deep link (figure or
 * achievements page) — that also marks it read. A "clear" affordance
 * deletes the row outright. "Mark all read" lives in the header.
 */
export default function NotificationsPage() {
  const t = useT();
  const me = useMe();
  const [tab, setTab] = useState("all"); // 'all' | 'unread'
  const list = useNotifications({ unreadOnly: tab === "unread", limit: 200 });
  const counts = useNotificationCounts();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const del = useDeleteNotification();
  useNotificationRealtime();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const unread = counts.data?.unread ?? 0;
  const total = counts.data?.total ?? 0;

  return (
    <AppShell>
      <main className="notif-page max-w-3xl mx-auto px-6 pt-8 pb-20">
        <Hero t={t} />

        <header className="notif-page-toolbar">
          <div className="notif-page-tabs">
            <button
              type="button"
              className={`notif-page-tab ${tab === "all" ? "is-active" : ""}`}
              onClick={() => setTab("all")}
            >
              {t("notifications.tab.all")} <em>{total}</em>
            </button>
            <button
              type="button"
              className={`notif-page-tab ${tab === "unread" ? "is-active" : ""}`}
              onClick={() => setTab("unread")}
            >
              {t("notifications.tab.unread")} <em>{unread}</em>
            </button>
          </div>
          {unread > 0 ? (
            <button
              type="button"
              className="notif-page-mark-all"
              onClick={() => markAll.mutate()}
            >
              ✓ {t("notifications.mark_all_read")}
            </button>
          ) : null}
        </header>

        {list.isLoading ? (
          <p className="notif-page-empty">…</p>
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState tab={tab} t={t} />
        ) : (
          <ul className="notif-page-list">
            {list.data.map((n) => (
              <NotifRow
                key={n.id}
                n={n}
                t={t}
                onRead={() => markRead.mutate(n.id)}
                onDelete={() => del.mutate(n.id)}
              />
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

function Hero({ t }) {
  return (
    <header className="notif-page-hero">
      <p className="notif-page-eyebrow">— {t("notifications.popover.eyebrow")}</p>
      <h1 className="notif-page-title">{t("notifications.title")}</h1>
      <p className="notif-page-sub">{t("notifications.subtitle")}</p>
    </header>
  );
}

function EmptyState({ tab, t }) {
  return (
    <div className="notif-page-empty-card">
      <p className="notif-page-empty-kanji" aria-hidden>
        無
      </p>
      <p className="notif-page-empty-line">
        {tab === "unread"
          ? t("notifications.empty.unread")
          : t("notifications.empty")}
      </p>
    </div>
  );
}

function NotifRow({ n, t, onRead, onDelete }) {
  const { title, sub, href, kanji } = formatNotification(n, t);
  return (
    <li className={`notif-page-row ${n.read_at ? "is-read" : "is-unread"}`}>
      <span className="notif-page-row-glyph" aria-hidden>
        {kanji}
      </span>
      <div className="notif-page-row-body">
        {href ? (
          <Link
            to={href}
            onClick={onRead}
            className="notif-page-row-title"
          >
            {title}
          </Link>
        ) : (
          <span className="notif-page-row-title">{title}</span>
        )}
        {sub ? <span className="notif-page-row-sub">{sub}</span> : null}
        <span className="notif-page-row-time">
          {new Date(n.created_at).toLocaleString()}
        </span>
      </div>
      <div className="notif-page-row-actions">
        {!n.read_at ? (
          <button
            type="button"
            onClick={onRead}
            className="notif-page-row-action"
            title={t("notifications.row.mark_read")}
            aria-label={t("notifications.row.mark_read")}
          >
            ✓
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          className="notif-page-row-action is-danger"
          title={t("notifications.row.delete")}
          aria-label={t("notifications.row.delete")}
        >
          ×
        </button>
      </div>
    </li>
  );
}
