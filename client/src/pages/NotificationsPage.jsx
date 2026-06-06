import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
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
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { formatNotification } from "../lib/notificationMessages.js";

// Presentational only: each notification kind projects its own accent light
// (mirrors the design system's per-type "spotlight" idea). Falls back to the
// gold/laque/jade/indigo/néon theme vars so it flips correctly on both themes.
const TONE_BY_EVENT = {
  achievement_unlocked: "var(--color-neon-amber)",
  preorder_release_today: "var(--color-neon-cyan)",
  preorder_release_j7: "var(--color-jade)",
  preorder_delivery_today: "var(--color-indigo)",
  preorder_delivery_overdue: "var(--color-laque-bright)",
  manga_server_approved: "var(--color-jade)",
  manga_server_revoked: "var(--color-laque-bright)",
};
const toneForEvent = (eventType) =>
  TONE_BY_EVENT[eventType] ?? "var(--color-or)";

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

        <Reveal as="header" className="notif-page-toolbar" delay={0.16} y={12}>
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
              {t("notifications.tab.unread")}{" "}
              <em style={unread > 0 ? { color: "var(--color-neon-cyan)" } : undefined}>
                {unread}
              </em>
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
        </Reveal>

        {list.isLoading ? (
          <p className="notif-page-empty">…</p>
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState tab={tab} t={t} />
        ) : (
          <ul className="notif-page-list">
            {list.data.map((n, i) => (
              <NotifRow
                key={n.id}
                n={n}
                t={t}
                index={i}
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
  const reduce = useReducedMotion();
  return (
    <header className="notif-page-hero" style={{ position: "relative" }}>
      {/* Localized hero colour-wash — a cyan→indigo aura (the "signal" hues)
        * pinned behind the title. pointer-events-none, low alpha, theme-aware
        * accent vars so it reads on porcelain and on noir alike. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -top-10 bottom-0"
        style={{
          zIndex: 0,
          backgroundImage: [
            "radial-gradient(40% 90% at 6% 30%, color-mix(in oklab, var(--color-neon-cyan) 14%, transparent), transparent 70%)",
            "radial-gradient(46% 90% at 60% 10%, color-mix(in oklab, var(--color-indigo) 13%, transparent), transparent 72%)",
            "radial-gradient(36% 80% at 96% 40%, color-mix(in oklab, var(--color-or) 12%, transparent), transparent 70%)",
          ].join(", "),
        }}
      />
      <motion.p
        className="notif-page-eyebrow"
        style={{ position: "relative", zIndex: 1, color: "var(--color-neon-cyan)" }}
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        — {t("notifications.popover.eyebrow")}
      </motion.p>
      <motion.h1
        className="notif-page-title"
        style={{ position: "relative", zIndex: 1 }}
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <AccentTitle text={t("notifications.page_title")} />
      </motion.h1>
      <motion.p
        className="notif-page-sub"
        style={{ position: "relative", zIndex: 1 }}
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        {t("notifications.subtitle")}
      </motion.p>
    </header>
  );
}

function EmptyState({ tab, t }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="notif-page-empty-card"
      style={{
        position: "relative",
        overflow: "hidden",
        borderColor: "color-mix(in oklab, var(--color-jade) 24%, transparent)",
      }}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Soft jade aura so the "all caught up" card feels calm, not empty. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          zIndex: 0,
          backgroundImage:
            "radial-gradient(60% 80% at 50% 0%, color-mix(in oklab, var(--color-jade) 12%, transparent), transparent 66%)",
        }}
      />
      <p
        className="notif-page-empty-kanji"
        aria-hidden
        style={{ position: "relative", zIndex: 1, color: "var(--color-jade)" }}
      >
        無
      </p>
      <p
        className="notif-page-empty-line"
        style={{ position: "relative", zIndex: 1 }}
      >
        {tab === "unread"
          ? t("notifications.empty.unread")
          : t("notifications.empty")}
      </p>
    </motion.div>
  );
}

function NotifRow({ n, t, index = 0, onRead, onDelete }) {
  const reduce = useReducedMotion();
  const { title, sub, href, kanji } = formatNotification(n, t);
  const unread = !n.read_at;
  const tone = toneForEvent(n.event_type);
  // Cap the stagger so a 200-row list doesn't take seconds to fully appear.
  const delay = Math.min(index, 12) * 0.04;
  return (
    <motion.li
      className={`notif-page-row group ${n.read_at ? "is-read" : "is-unread"}`}
      style={{ "--row-tone": tone }}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Per-event accent bleed from the left edge — saturated for unread,
        * faint for read. Brightens on hover (opacity only → 60fps). The
        * accent var flips with the theme. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-2/3 transition-opacity duration-300 ${
          unread ? "opacity-100 group-hover:opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
        style={{
          zIndex: 0,
          backgroundImage:
            "linear-gradient(90deg, color-mix(in oklab, var(--row-tone) 16%, transparent) 0%, transparent 70%)",
        }}
      />
      {/* A crisp accent rule on the very left edge marks the row's kind. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-0 w-px transition-opacity duration-300"
        style={{
          zIndex: 0,
          background: "var(--row-tone)",
          opacity: unread ? 0.8 : 0.25,
        }}
      />
      <span
        className="notif-page-row-glyph"
        aria-hidden
        style={{
          position: "relative",
          zIndex: 1,
          color: tone,
          opacity: unread ? 1 : 0.5,
        }}
      >
        {kanji}
      </span>
      <div className="notif-page-row-body" style={{ position: "relative", zIndex: 1 }}>
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
        {sub ? (
          <span className="notif-page-row-sub" style={{ color: tone, opacity: 0.95 }}>
            {sub}
          </span>
        ) : null}
        <span className="notif-page-row-time">
          {new Date(n.created_at).toLocaleString(document.documentElement.lang || undefined)}
        </span>
      </div>
      <div className="notif-page-row-actions" style={{ position: "relative", zIndex: 1 }}>
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
    </motion.li>
  );
}
