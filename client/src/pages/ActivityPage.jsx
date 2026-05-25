import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useActivity } from "../hooks/useActivity.js";
import AppShell from "../components/AppShell.jsx";

/**
 * Le Journal de bord — the user's chronological activity ledger.
 *
 * The page reads like flipping through a hand-kept logbook:
 *   - vertical "Journal de bord" tag running down the side
 *   - kanji-tile filter row to mute event types you don't care about
 *   - day-by-day grouping with a ribbon-strap heading per day
 *   - each entry is a manuscript line: brass-plate kanji glyph + typeset
 *     event description + mono relative timestamp in the margin + a
 *     paper-tape annotation for date slips + status arrows for transitions
 *
 * No charting library; the only motion is a hover gold-underline grow.
 */

/** Six event kinds with their visual treatment.
 *  kanji   — calligraphic mark for the brass plate
 *  tone    — sentiment pip colour (`positive` / `negative` / `neutral`)
 *  i18nKey — formatEntry uses this to look up the line wording */
const EVENT_KINDS = [
  { id: "owned_added",            kanji: "入", tone: "positive" },
  { id: "owned_removed",          kanji: "退", tone: "negative" },
  { id: "preorder_created",       kanji: "予", tone: "neutral"  },
  { id: "preorder_slipped",       kanji: "滑", tone: "negative" },
  { id: "preorder_status_changed",kanji: "状", tone: "neutral"  },
  { id: "preorder_received",      kanji: "受", tone: "positive" },
];
const KIND_META = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k]));

export default function ActivityPage() {
  const t = useT();
  const me = useMe();
  const activity = useActivity({ limit: 200 });

  // Filter — Set<kindId>. Empty Set = show everything (default).
  const [muted, setMuted] = useState(() => new Set());
  const toggle = (id) => {
    setMuted((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const events = activity.data ?? [];

  // Per-kind counts for the filter rail superscripts.
  const countsByKind = useMemo(() => {
    const m = new Map();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [events]);

  // Filtered + bucketed-by-day list.
  const days = useMemo(() => groupByDay(events.filter((e) => !muted.has(e.kind))), [
    events,
    muted,
  ]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <span
          aria-hidden
          className="kanji-mark text-[26rem] -top-24 -right-16 hidden md:block"
        >
          録
        </span>

        {/* Header */}
        <header className="relative grid grid-cols-[auto_1fr] gap-6 md:gap-10 items-center mb-10">
          <div className="vertical-tag reveal hidden md:block" style={{ "--i": 0 }}>
            {t("activity.vertical_tag")}
          </div>
          <div>
            <p className="micro reveal" style={{ "--i": 0 }}>
              {t("activity.subtitle")}
            </p>
            <h1
              className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
              style={{ "--i": 1 }}
            >
              {t("activity.title")}
            </h1>
            <p
              className="display italic text-[var(--color-or-pale)]/80 text-lg md:text-xl mt-3 reveal"
              style={{ "--i": 2 }}
            >
              {t("activity.kicker")}
            </p>
            <div className="gold-rule w-24 mt-6 reveal" style={{ "--i": 3 }} />
          </div>
        </header>

        {/* Filter rail — same kanji-tile idiom as /browse + /collection */}
        {events.length > 0 ? (
          <nav
            aria-label="filter by event type"
            className="tile-rail mb-10 reveal"
            style={{ "--i": 4 }}
          >
            {EVENT_KINDS.map((k) => {
              const count = countsByKind.get(k.id) ?? 0;
              if (count === 0) return null;
              const active = !muted.has(k.id);
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => toggle(k.id)}
                  aria-pressed={active}
                  className={`tile ${active ? "is-active" : ""}`}
                  title={t(`activity.kind.${k.id}`)}
                >
                  <span className="tile-count" aria-hidden>
                    {count}
                  </span>
                  <span className="tile-kanji" aria-hidden>
                    {k.kanji}
                  </span>
                  <span className="tile-romaji">
                    {t(`activity.kind.${k.id}`)}
                  </span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {/* Daybook */}
        {activity.isLoading ? (
          <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">…</p>
        ) : events.length === 0 ? (
          <EmptyJournal t={t} />
        ) : days.length === 0 ? (
          <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">
            {t("activity.filtered_empty")}
          </p>
        ) : (
          <section className="journal" aria-label="journal entries">
            {days.map((day, i) => (
              <DaySection key={day.key} day={day} index={i} t={t} />
            ))}
          </section>
        )}
      </main>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Day section — ribbon strap header + entries

function DaySection({ day, index, t }) {
  return (
    <div
      className="reveal"
      style={{ "--i": Math.min(index + 5, 10) }}
    >
      <header className="day-strap">
        <div>
          <span className="day-strap-relative" aria-hidden>
            {day.relative ? t(day.relative) : ""}
          </span>
          <h2 className="day-strap-date">
            {day.date.day}{" "}
            <span className="text-[var(--color-or-pale)]">{day.date.month}</span>{" "}
            <sup>{day.date.year}</sup>
          </h2>
        </div>
        <span className="day-strap-rule" aria-hidden />
        <span className="day-strap-count">
          {day.events.length} {t("activity.day.events")}
        </span>
      </header>

      <ol>
        {day.events.map((ev) => (
          <Entry key={ev.id} ev={ev} t={t} />
        ))}
      </ol>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry — one manuscript line

function Entry({ ev, t }) {
  const meta = KIND_META[ev.kind];
  const time = new Date(ev.created_at);
  const figureId = ev.payload?.figure_id;
  const figureName = ev.payload?.figure_name;
  const figureImage = ev.payload?.figure_image;

  return (
    <li className="entry">
      <div className={`entry-glyph entry-glyph--${meta?.tone ?? "neutral"}`}>
        <span className="entry-glyph-kanji" aria-hidden>
          {meta?.kanji ?? "・"}
        </span>
      </div>

      <div className="entry-body">
        <p className="entry-line">
          <EntryLine ev={ev} t={t} figureId={figureId} figureName={figureName} />
        </p>

        {/* Slipped preorder — pin a paper-tape annotation showing from → to */}
        {ev.kind === "preorder_slipped" ? (
          <SlipTape
            from={ev.payload?.from_date}
            to={ev.payload?.to_date}
          />
        ) : null}

        {/* Status transition — two pills with an arrow between them */}
        {ev.kind === "preorder_status_changed" ? (
          <StatusArrow
            from={ev.payload?.from_status}
            to={ev.payload?.to_status}
            t={t}
          />
        ) : null}

        <span className="entry-time">
          <time dateTime={ev.created_at} title={time.toLocaleString()}>
            {formatTimeOfDay(time)} · {relativeShort(time)}
          </time>
        </span>

        {figureImage ? (
          <Link
            to={figureId ? `/figures/${figureId}` : "#"}
            className="entry-thumb"
            aria-label={figureName}
          >
            <img src={figureImage} alt="" loading="lazy" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/** The typeset event description. The figure name is wrapped in <strong>
 *  (which is restyled to a display serif via .entry-line strong) and linked
 *  to the figure detail page when we know the id. */
function EntryLine({ ev, t, figureId, figureName }) {
  const wrap = (children) =>
    figureId ? <Link to={`/figures/${figureId}`}>{children}</Link> : children;

  const name = (
    <strong>{figureName ?? t("activity.unknown_figure")}</strong>
  );

  switch (ev.kind) {
    case "owned_added":
      return (
        <>
          {t("activity.line.owned_added.prefix")} {wrap(name)}
        </>
      );
    case "owned_removed":
      return (
        <>
          {t("activity.line.owned_removed.prefix")} {wrap(name)}
        </>
      );
    case "preorder_created":
      return (
        <>
          {t("activity.line.preorder_created.prefix")} {wrap(name)}
        </>
      );
    case "preorder_slipped":
      return (
        <>
          {t("activity.line.preorder_slipped.prefix")} {wrap(name)}
        </>
      );
    case "preorder_status_changed":
      return (
        <>
          {t("activity.line.preorder_status_changed.prefix")} {wrap(name)}
        </>
      );
    case "preorder_received":
      return (
        <>
          {t("activity.line.preorder_received.prefix")} {wrap(name)}
        </>
      );
    default:
      return (
        <>
          {t("activity.event.fallback", { kind: ev.kind })}
          {figureName ? <> · {wrap(name)}</> : null}
        </>
      );
  }
}

function SlipTape({ from, to }) {
  return (
    <span className="slip-tape" aria-label="release date slipped">
      <span>{from ?? "?"}</span>
      <span className="slip-arrow" aria-hidden>
        →
      </span>
      <span>{to ?? "?"}</span>
    </span>
  );
}

function StatusArrow({ from, to, t }) {
  return (
    <span className="status-arrow" aria-label="status changed">
      <span className="status-arrow-pill">
        {from ? t(`status.${from}`, { default: from }) : "?"}
      </span>
      <span className="status-arrow-glyph" aria-hidden>
        →
      </span>
      <span className="status-arrow-pill status-arrow-pill--to">
        {to ? t(`status.${to}`, { default: to }) : "?"}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — a wax seal + a calligraphic line

function EmptyJournal({ t }) {
  return (
    <div className="journal-empty">
      <div className="journal-empty-seal" aria-hidden>
        空
      </div>
      <div>
        <p className="display italic text-2xl text-[var(--color-or-pale)]">
          {t("activity.empty.title")}
        </p>
        <p className="micro-tight mt-3 opacity-80">
          {t("activity.empty.body")}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping + formatting

/** Bucket the chronological event list by calendar day. Returns an array of
 *  { key, date, events, relative } shaped objects in the same chronological
 *  order as the input (most recent day first, most recent event first
 *  within each day). */
function groupByDay(events) {
  const days = [];
  const idxByKey = new Map();
  for (const ev of events) {
    const d = new Date(ev.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let i = idxByKey.get(key);
    if (i === undefined) {
      i = days.length;
      idxByKey.set(key, i);
      days.push({
        key,
        date: {
          day: d.getDate(),
          month: d.toLocaleDateString(undefined, { month: "long" }),
          year: d.getFullYear(),
          weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
          raw: d,
        },
        events: [],
        relative: null,
      });
    }
    days[i].events.push(ev);
  }
  // Annotate first two days with relative labels so "today / yesterday" feel
  // natural without losing the date itself.
  const today = stripTime(new Date());
  for (const day of days) {
    const diff = Math.round(
      (today.getTime() - stripTime(day.date.raw).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diff === 0) day.relative = "activity.relative.today";
    else if (diff === 1) day.relative = "activity.relative.yesterday";
    else if (diff < 7) day.relative = "activity.relative.this_week";
  }
  return days;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatTimeOfDay(d) {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "il y a 3 h" — tight relative formatter for the entry margin. */
function relativeShort(d) {
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}j`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)} mo`;
  return `${Math.floor(diff / 86400 / 365)} an${diff >= 86400 * 730 ? "s" : ""}`;
}
