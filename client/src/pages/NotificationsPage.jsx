import { useMemo, useState } from "react";
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
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import EmptyState from "../components/EmptyState.jsx";
import StatCard from "../components/StatCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { formatNotification } from "../lib/notificationMessages.js";

// Per-event accent — the kanji "type marker" carries its own lifecycle hue so
// the inbox stays a living colour-key (achievement gold, livraison-overdue
// laque, etc.). Theme CSS vars, so it flips on porcelain + noir alike. NOTE:
// this colours the *glyph only*. The row's read/unread STATE is signalled in
// hanko-red (the single hot accent), kept separate on purpose.
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
 * /notifications — the boîte de réception, elevated to Direction A.
 *
 * Editorial header (kicker · 報 · INBOX → AccentTitle → gold-rule) over a
 * StatCard strip (total · non lues in hanko-red · lues), an A pill toolbar
 * (all / unread + "tout marquer lu"), then the log as a date-grouped timeline:
 * each day threads a kanji-marked header, and each notification is a refined
 * row with a left accent spine (hanko-red = unread, quiet gold = read), the
 * per-event kanji type marker, a deep link that marks-read on click, and
 * mark-read / clear controls. The shared EmptyState carries the "tout est lu"
 * moment.
 *
 * Logic is unchanged: same two tabs, same queries/mutations, same realtime
 * refetch, same 200-row page — only the JSX is restyled/restructured.
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

  // Group the visible rows by calendar day so the inbox reads as a register
  // rather than a flat stream. Memoised on the list payload + locale.
  const groups = useMemo(
    () => groupByDay(list.data ?? [], t),
    [list.data, t],
  );

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const unread = counts.data?.unread ?? 0;
  const total = counts.data?.total ?? 0;
  const read = Math.max(total - unread, 0);

  return (
    <AppShell>
      <main className="notif-page relative max-w-3xl mx-auto px-6 pt-12 pb-24">
        {/* ─── Editorial header ─── */}
        <header className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[20rem] -top-24 -right-6 hidden md:block"
          >
            報
          </span>

          <p className="micro reveal" style={{ "--i": 0 }}>
            {t("notifications.popover.eyebrow")}
            <span aria-hidden className="ja mx-2 not-italic">報</span>
            {t("notifications.kicker_tag", { default: "JOURNAL" })}
          </p>
          <h1
            className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("notifications.page_title")} />
          </h1>
          <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
          <p
            className="display-italic text-base mt-4 text-[var(--color-ivoire-soft)]/80 reveal"
            style={{ "--i": 3 }}
          >
            {t("notifications.subtitle")}
          </p>

          {total > 0 ? (
            <div
              className="mt-8 grid grid-cols-3 gap-3 reveal"
              style={{ "--i": 3 }}
            >
              <StatCard label={t("notifications.tab.all")} value={total} />
              <StatCard
                label={t("notifications.tab.unread")}
                value={unread}
                tone={unread > 0 ? "red" : undefined}
              />
              <StatCard
                label={t("notifications.stat.read", { default: "Lues" })}
                value={read}
                tone="gold"
              />
            </div>
          ) : null}
        </header>

        {/* ─── A toolbar: tab pills + mark-all ─── */}
        <Reveal
          as="div"
          delay={0.16}
          y={12}
          className="mb-8 flex flex-wrap items-center justify-between gap-4"
        >
          <nav
            className="flex flex-wrap gap-2"
            aria-label={t("notifications.popover.eyebrow")}
          >
            <TabPill
              active={tab === "all"}
              onClick={() => setTab("all")}
              label={t("notifications.tab.all")}
              count={total}
            />
            <TabPill
              active={tab === "unread"}
              onClick={() => setTab("unread")}
              label={t("notifications.tab.unread")}
              count={unread}
              hot={unread > 0}
            />
          </nav>
          {unread > 0 ? (
            <Button
              variant="ghost"
              onClick={() => markAll.mutate()}
              loading={markAll.isPending}
              className="!px-4 !py-2 !text-[11px] !uppercase !tracking-[0.22em]"
            >
              <span aria-hidden>✓</span>
              {t("notifications.mark_all_read")}
            </Button>
          ) : null}
        </Reveal>

        {/* ─── Empty / loading / timeline ─── */}
        {list.isLoading ? (
          <p
            role="status"
            aria-live="polite"
            className="text-center text-[var(--color-ivoire-soft)] py-16"
          >
            …
          </p>
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState
            kanji="無"
            hue="var(--color-jade)"
            eyebrow={t("notifications.popover.eyebrow")}
            title={
              tab === "unread"
                ? t("notifications.empty.unread")
                : t("notifications.empty")
            }
            body={t("notifications.empty.body", {
              default: "Les nouvelles à ton sujet apparaîtront ici.",
            })}
          />
        ) : (
          <div className="space-y-10">
            {groups.map((g) => (
              <DayGroup
                key={g.key}
                group={g}
                t={t}
                onRead={(id) => markRead.mutate(id)}
                onDelete={(id) => del.mutate(id)}
              />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

// =============================================================================
// Toolbar pill — an A control mirroring the filter chips on Collection/Preorders
// =============================================================================

function TabPill({ active, onClick, label, count, hot = false }) {
  // Active = gold ring + wash (the resting A "is-active" look). When this is
  // the unread tab AND there are unread items, swap to the hanko-red accent so
  // the single hot colour signals "needs attention" even when inactive.
  const accent = hot ? "var(--color-laque-bright)" : "var(--color-or)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="tap-target inline-flex items-center gap-2 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.22em] border transition-colors"
      style={{
        color: active
          ? accent
          : hot
            ? "var(--color-laque-bright)"
            : "var(--color-ivoire-soft)",
        borderColor: active
          ? accent
          : `color-mix(in oklab, ${accent} 30%, transparent)`,
        background: active
          ? `color-mix(in oklab, ${accent} 9%, transparent)`
          : "transparent",
      }}
    >
      {label}
      <span
        className="figural text-sm leading-none"
        aria-hidden
        style={{ color: accent }}
      >
        {count}
      </span>
    </button>
  );
}

// =============================================================================
// Day group — a kanji-marked date header threading a stack of rows
// =============================================================================

function DayGroup({ group, t, onRead, onDelete }) {
  return (
    <section>
      <Reveal as="header" y={12} amount={0.6} className="flex items-center gap-3 mb-4">
        <span
          aria-hidden
          className="ja grid place-items-center w-9 h-9 text-base rounded-full border"
          style={{
            color: "var(--color-or)",
            borderColor: "color-mix(in oklab, var(--color-or) 45%, transparent)",
            background: "color-mix(in oklab, var(--color-or) 6%, transparent)",
          }}
        >
          {group.kanji}
        </span>
        <h2 className="display text-xl text-[var(--color-ivoire)]">
          {group.label}
        </h2>
        {group.unread > 0 ? (
          <span
            className="figural text-xs px-2 py-0.5 leading-none rounded-full"
            style={{
              color: "var(--color-laque-bright)",
              border:
                "1px solid color-mix(in oklab, var(--color-laque-bright) 45%, transparent)",
              background:
                "color-mix(in oklab, var(--color-laque) 12%, transparent)",
            }}
            title={t("notifications.tab.unread")}
          >
            {group.unread}
          </span>
        ) : null}
        {/* Trailing hairline — gives the divider horizon, GPU-free. */}
        <span
          aria-hidden
          className="hidden sm:block h-px flex-1 self-center"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--color-or) 35%, transparent), transparent)",
          }}
        />
      </Reveal>

      <ul className="space-y-px">
        {group.entries.map((n, i) => (
          <NotifRow
            key={n.id}
            n={n}
            t={t}
            index={i}
            onRead={() => onRead(n.id)}
            onDelete={() => onDelete(n.id)}
          />
        ))}
      </ul>
    </section>
  );
}

// =============================================================================
// Notification row — refined A ledger line
// =============================================================================

function NotifRow({ n, t, index = 0, onRead, onDelete }) {
  const { title, sub, href, kanji } = formatNotification(n, t);
  const unread = !n.read_at;
  // Per-event hue tints the kanji TYPE marker; read/unread STATE is hanko-red.
  const tone = toneForEvent(n.event_type);
  const stateAccent = unread
    ? "var(--color-laque-bright)"
    : "color-mix(in oklab, var(--color-or) 38%, transparent)";
  // Cap the stagger so a 200-row list doesn't take seconds to fully appear.
  const delay = Math.min(index, 12) * 0.04;

  return (
    <Reveal
      as="li"
      delay={delay}
      y={14}
      amount={0.3}
      className="group relative grid grid-cols-[auto_1fr_auto] items-start gap-4 pl-4 pr-2 py-4 border-b border-dashed transition-colors"
      style={{
        borderColor: "color-mix(in oklab, var(--color-or) 14%, transparent)",
        background: unread
          ? "linear-gradient(90deg, color-mix(in oklab, var(--color-laque) 7%, transparent) 0%, transparent 32%)"
          : "transparent",
      }}
    >
      {/* Left state spine — hanko-red for unread, quiet gold for read.
        * Widens + brightens on hover (transform/opacity only → 60fps). */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[2px] origin-left transition-[transform,opacity] duration-300 ease-out group-hover:scale-x-150 group-hover:opacity-100 motion-reduce:transition-none"
        style={{
          background: stateAccent,
          opacity: unread ? 0.95 : 0.4,
        }}
      />

      {/* Type marker — per-event kanji in its lifecycle hue, dimmed when read.
        * An unread dot in hanko-red rides the corner as the state cue. */}
      <div className="relative self-center" style={{ width: "2rem" }}>
        <span
          className="ja block text-3xl leading-none text-center"
          aria-hidden
          style={{ color: tone, opacity: unread ? 1 : 0.5 }}
        >
          {kanji}
        </span>
        {unread ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-0.5 w-2 h-2 rounded-full"
            style={{
              background: "var(--color-laque-bright)",
              boxShadow:
                "0 0 8px -1px color-mix(in oklab, var(--color-laque-bright) 80%, transparent)",
            }}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex flex-col gap-1">
        {href ? (
          <Link
            to={href}
            onClick={onRead}
            className="font-[var(--font-display)] text-[1.08rem] leading-snug no-underline transition-colors hover:text-[var(--color-or-pale)]"
            style={{
              color: unread
                ? "var(--color-ivoire)"
                : "var(--color-ivoire-soft)",
            }}
          >
            {title}
          </Link>
        ) : (
          <span
            className="font-[var(--font-display)] text-[1.08rem] leading-snug"
            style={{
              color: unread
                ? "var(--color-ivoire)"
                : "var(--color-ivoire-soft)",
            }}
          >
            {title}
          </span>
        )}
        {sub ? (
          <span
            className="font-[var(--font-mono)] text-[9.5px] uppercase tracking-[0.22em]"
            style={{ color: tone, opacity: 0.9 }}
          >
            {sub}
          </span>
        ) : null}
        <span
          className="font-[var(--font-mono)] text-[9px] tracking-[0.12em] text-[var(--color-or-pale)]/50"
        >
          {new Date(n.created_at).toLocaleString(
            document.documentElement.lang || undefined,
          )}
        </span>
      </div>

      <div className="relative flex flex-col gap-1.5 self-center">
        {!n.read_at ? (
          <button
            type="button"
            onClick={onRead}
            className="tap-target grid place-items-center w-9 h-9 font-[var(--font-mono)] text-[13px] border transition-colors text-[var(--color-or-pale)] hover:text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)]"
            style={{
              borderColor:
                "color-mix(in oklab, var(--color-or) 20%, transparent)",
            }}
            title={t("notifications.row.mark_read")}
            aria-label={t("notifications.row.mark_read")}
          >
            ✓
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          className="tap-target grid place-items-center w-9 h-9 font-[var(--font-mono)] text-[13px] border transition-colors text-[var(--color-or-pale)] hover:text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)]"
          style={{
            borderColor: "color-mix(in oklab, var(--color-or) 20%, transparent)",
          }}
          title={t("notifications.row.delete")}
          aria-label={t("notifications.row.delete")}
        >
          ×
        </button>
      </div>
    </Reveal>
  );
}

// =============================================================================
// Date grouping
// =============================================================================

/** Local YYYY-MM-DD for a Date. */
function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Group notifications into calendar-day buckets (newest first), each carrying
 * a localised header label + a kanji marker + its unread tally. Today / Hier
 * get friendly labels; older days fall back to a localised long date. Input
 * order is preserved within a day (the API already returns newest-first).
 *
 * Returns [{ key, label, kanji, unread, entries: [] }].
 */
function groupByDay(list, t) {
  const now = new Date();
  const todayK = dayKey(now);
  const yK = dayKey(new Date(now.getTime() - 86400000));
  const lang = (typeof document !== "undefined" && document.documentElement.lang) || undefined;

  const order = [];
  const map = new Map();
  for (const n of list) {
    const created = new Date(n.created_at);
    const key = Number.isNaN(created.getTime()) ? "unknown" : dayKey(created);
    if (!map.has(key)) {
      map.set(key, { key, created, entries: [], unread: 0 });
      order.push(key);
    }
    const bucket = map.get(key);
    bucket.entries.push(n);
    if (!n.read_at) bucket.unread += 1;
  }

  // 今 (now/today), 昨 (yesterday), 報 (other days — "news"), 不 (unknown date).
  return order.map((key) => {
    const bucket = map.get(key);
    let label;
    let kanji = "報";
    if (key === "unknown") {
      label = t("notifications.day.unknown", { default: "Date inconnue" });
      kanji = "不";
    } else if (key === todayK) {
      label = t("notifications.day.today", { default: "Aujourd'hui" });
      kanji = "今";
    } else if (key === yK) {
      label = t("notifications.day.yesterday", { default: "Hier" });
      kanji = "昨";
    } else {
      label = bucket.created.toLocaleDateString(lang, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      label = label.charAt(0).toUpperCase() + label.slice(1);
    }
    return {
      key,
      label,
      kanji,
      unread: bucket.unread,
      entries: bucket.entries,
    };
  });
}
