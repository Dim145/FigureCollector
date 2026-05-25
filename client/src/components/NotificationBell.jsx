import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationCounts,
  useNotificationRealtime,
  useNotifications,
} from "../hooks/useNotifications.js";
import { formatNotification } from "../lib/notificationMessages.js";

/**
 * Navbar bell. Shows an unread badge, and on click opens a popover
 * listing the 8 most recent notifications with a "See all" link to the
 * dedicated /notifications page.
 *
 * Hooks the WebSocket `notification_created` event so the badge updates
 * in real-time without polling.
 */
export default function NotificationBell() {
  const t = useT();
  const counts = useNotificationCounts();
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);
  useNotificationRealtime();

  // Close on click-outside + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!popRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = counts.data?.unread ?? 0;

  return (
    <span ref={popRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("notifications.bell.aria", { n: unread })}
        className="notif-bell"
      >
        <span aria-hidden className="notif-bell-icon">
          ◔
        </span>
        {unread > 0 ? (
          <span aria-hidden className="notif-bell-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? <Popover t={t} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function Popover({ t, onClose }) {
  const list = useNotifications({ limit: 8 });
  const counts = useNotificationCounts();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const total = counts.data?.total ?? 0;
  const unread = counts.data?.unread ?? 0;

  return (
    <div role="dialog" className="notif-popover">
      <header className="notif-popover-head">
        <span className="notif-popover-eyebrow">
          — {t("notifications.popover.eyebrow")}
        </span>
        <h3 className="notif-popover-title">{t("notifications.title")}</h3>
      </header>

      <div className="notif-popover-tabs">
        <span className={`notif-popover-tab ${unread > 0 ? "" : "is-dim"}`}>
          <span aria-hidden className="notif-popover-tab-dot" />
          {t("notifications.tab.unread")} <em>{unread}</em>
        </span>
        <span className="notif-popover-tab is-all">
          {t("notifications.tab.all")} <em>{total}</em>
        </span>
      </div>

      {list.isLoading ? (
        <p className="notif-popover-empty">…</p>
      ) : (list.data ?? []).length === 0 ? (
        <p className="notif-popover-empty">{t("notifications.empty")}</p>
      ) : (
        <ul className="notif-popover-list">
          {list.data.slice(0, 8).map((n) => (
            <PopoverRow
              key={n.id}
              n={n}
              t={t}
              onClick={() => {
                if (!n.read_at) markRead.mutate(n.id);
                onClose();
              }}
            />
          ))}
        </ul>
      )}

      <footer className="notif-popover-foot">
        {unread > 0 ? (
          <button
            type="button"
            className="notif-popover-foot-btn"
            onClick={() => markAll.mutate()}
          >
            ✓ {t("notifications.mark_all_read")}
          </button>
        ) : (
          <span />
        )}
        <Link
          to="/notifications"
          onClick={onClose}
          className="notif-popover-foot-link"
        >
          {t("notifications.see_all")} →
        </Link>
      </footer>
    </div>
  );
}

function PopoverRow({ n, t, onClick }) {
  const { title, sub, href, kanji } = formatNotification(n, t);
  const Row = (
    <>
      <span className="notif-popover-row-glyph" aria-hidden>
        {kanji}
      </span>
      <span className="notif-popover-row-body">
        <span className="notif-popover-row-title">{title}</span>
        {sub ? <span className="notif-popover-row-sub">{sub}</span> : null}
        <span className="notif-popover-row-time">{relTime(n.created_at, t)}</span>
      </span>
      {!n.read_at ? (
        <span className="notif-popover-row-unread" aria-hidden />
      ) : null}
    </>
  );
  const className = `notif-popover-row ${n.read_at ? "is-read" : "is-unread"}`;
  if (href) {
    return (
      <li>
        <Link to={href} onClick={onClick} className={className}>
          {Row}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={onClick} className={className}>
        {Row}
      </button>
    </li>
  );
}

/** Lightweight relative time formatter — "il y a 5 min", "il y a 2 h",
 *  "il y a 3 j", date for older. */
function relTime(iso, t) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return t("notifications.time.just_now");
  if (diff < 3600) return t("notifications.time.minutes", { n: Math.round(diff / 60) });
  if (diff < 86400) return t("notifications.time.hours", { n: Math.round(diff / 3600) });
  if (diff < 86400 * 7) return t("notifications.time.days", { n: Math.round(diff / 86400) });
  return d.toLocaleDateString();
}
