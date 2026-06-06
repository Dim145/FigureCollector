import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useActivity } from "../hooks/useActivity.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import StatCard from "../components/StatCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * Le Journal de bord — the user's chronological activity ledger, rendered as a
 * refined editorial **timeline** (Direction A "shōjo-noir").
 *
 * The page threads every event down a single **gold spine**:
 *   - an editorial header (kicker · 録 · AccentTitle · gold-rule) with a
 *     bleeding kanji-mark watermark, then a StatCard strip of activity counts
 *   - a kanji-tile filter row to mute event types you don't care about
 *   - the spine itself, with **month markers** (kanji 月-style cartouche) and
 *     **dated day nodes** sitting *on* the rule
 *   - each event is a row hung off the spine: a circular kanji node inked in
 *     the event's own hue + a typeset line + a paper-tape slip annotation +
 *     status arrows + a mono relative timestamp in the margin
 *
 * The timeline structure here is built from Tailwind + inline `var(--color-*)`
 * styles only (no new global CSS) — GPU-light: flat fills, hairlines, static
 * gradients, opacity/transform hovers, and the shared `Reveal` for enter.
 */

/** Six event kinds with their visual treatment.
 *  kanji   — calligraphic mark for the timeline node
 *  tone    — sentiment pip colour (`positive` / `negative` / `neutral`)
 *  accent  — a theme CSS var giving each kind its own colour signature; the
 *            node ring, glyph and hover-wash all tone off this one value.
 *            Every entry is a `var()` so the palette flips light/dark. */
const EVENT_KINDS = [
  { id: "owned_added",            kanji: "入", tone: "positive", accent: "var(--color-jade)"        },
  { id: "owned_removed",          kanji: "退", tone: "negative", accent: "var(--color-laque-bright)" },
  { id: "preorder_created",       kanji: "予", tone: "neutral",  accent: "var(--color-indigo)"      },
  { id: "preorder_slipped",       kanji: "滑", tone: "negative", accent: "var(--color-neon-amber)"  },
  { id: "preorder_status_changed",kanji: "状", tone: "neutral",  accent: "var(--color-neon-cyan)"   },
  { id: "preorder_received",      kanji: "受", tone: "positive", accent: "var(--color-or)"          },
];
const KIND_META = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k]));

/** The accent for an event kind, falling back to gold (always on-brand). */
function kindAccent(kind) {
  return KIND_META[kind]?.accent ?? "var(--color-or)";
}

/** Kinds that read as "acquisitions" (a piece entering the collection) — used
 *  for the StatCard strip count. */
const ACQUIRED_KINDS = new Set(["owned_added", "preorder_received"]);
/** Kinds that touch a preorder's lifecycle — used for the StatCard strip. */
const PREORDER_KINDS = new Set([
  "preorder_created",
  "preorder_slipped",
  "preorder_status_changed",
  "preorder_received",
]);

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

  // Headline stats for the strip (all derived from the loaded window).
  const stats = useMemo(() => deriveStats(events), [events]);

  // Filtered, then bucketed day-by-day, then those days threaded into months
  // for the spine's month markers.
  const days = useMemo(
    () => groupByDay(events.filter((e) => !muted.has(e.kind))),
    [events, muted],
  );
  const months = useMemo(() => groupByMonth(days), [days]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="relative max-w-4xl mx-auto px-6 py-12">
        {/* Localised colour-wash behind the header — three soft blooms in the
         *  journal's signature accents (jade acquisition · indigo
         *  anticipation · amber motion). Absolutely positioned, aria-hidden
         *  and pointer-events-none so it's pure decoration; masked to fade
         *  out before the timeline. Every colour is a theme var() mixed to
         *  transparency, so the wash flips with the light/dark theme and
         *  rides gently over the global aurora. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-6 h-[340px] -z-0"
          style={{
            background:
              "radial-gradient(52% 70% at 16% 8%, color-mix(in oklab, var(--color-jade) 18%, transparent), transparent 70%), radial-gradient(48% 64% at 84% 0%, color-mix(in oklab, var(--color-indigo) 20%, transparent), transparent 72%), radial-gradient(40% 56% at 56% 40%, color-mix(in oklab, var(--color-neon-amber) 12%, transparent), transparent 75%)",
            maskImage:
              "radial-gradient(82% 90% at 50% 30%, black, transparent 100%)",
          }}
        />

        <span
          aria-hidden
          className="kanji-mark text-[26rem] -top-24 -right-16 hidden md:block"
        >
          録
        </span>

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
              <AccentTitle text={t("activity.page_title")} />
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

        {/* Activity-count strip — figurine-domain metrics drawn from the
         *  loaded window. Total entries (ivoire), acquisitions 入 (gold =
         *  pieces gained), preorder movements 予 (red = anticipation), and
         *  this calendar month's tempo. Collapses 2-up on mobile. */}
        {events.length > 0 ? (
          <div
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10 reveal"
            style={{ "--i": 4 }}
          >
            <StatCard
              label={t("activity.stat.entries", { default: "Entrées" })}
              value={stats.total}
            />
            <StatCard
              label={t("activity.stat.acquired", { default: "Acquisitions" })}
              value={stats.acquired}
              tone="gold"
            />
            <StatCard
              label={t("activity.stat.preorders", { default: "Pré-commandes" })}
              value={stats.preorders}
              tone="red"
            />
            <StatCard
              label={t("activity.stat.this_month", { default: "Ce mois-ci" })}
              value={stats.thisMonth}
            />
          </div>
        ) : null}

        {/* Filter rail — same kanji-tile idiom as /browse + /collection */}
        {events.length > 0 ? (
          <nav
            aria-label="filter by event type"
            className="tile-rail mb-10 reveal"
            style={{ "--i": 5 }}
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

        {/* Timeline */}
        {activity.isLoading ? (
          <p
            role="status"
            aria-live="polite"
            className="text-center text-[var(--color-ivoire-soft)] italic py-16"
          >
            …
          </p>
        ) : activity.isError ? (
          <p
            role="alert"
            className="text-center text-[var(--color-ivoire-soft)] italic py-16"
          >
            {t("error.unknown")}
          </p>
        ) : events.length === 0 ? (
          <EmptyJournal t={t} />
        ) : days.length === 0 ? (
          <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">
            {t("activity.filtered_empty")}
          </p>
        ) : (
          <Timeline months={months} t={t} />
        )}
      </main>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline — the gold spine, month markers, dated day nodes, event rows

/** The whole ledger threaded down one continuous gold spine. The spine is a
 *  hairline gradient pinned to a fixed gutter; every month marker, day node
 *  and event node lands on that same x so the eye reads a single thread. */
function Timeline({ months, t }) {
  return (
    // `--spine-x` is the shared x of the rule, declared on the common
    // ancestor so BOTH the spine rule and every node/marker resolve the same
    // value. Tighter gutter on mobile, roomier on md+.
    <section
      className="relative md:[--spine-x:1.5rem]"
      style={{ "--spine-x": "1.25rem" }}
      aria-label="journal entries"
    >
      {/* The spine — a 1px gold gradient rule pinned to the gutter. Static
       *  (no animation), theme-var driven, decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-2 bottom-2 w-px"
        style={{
          left: "var(--spine-x)",
          background:
            "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-or) 38%, transparent) 6%, color-mix(in oklab, var(--color-or) 38%, transparent) 94%, transparent)",
        }}
      />
      <div>
        {months.map((m, i) => (
          <MonthBlock key={m.key} month={m} index={i} t={t} />
        ))}
      </div>
    </section>
  );
}

/** A calendar month on the spine: a kanji 月 cartouche marker sitting on the
 *  rule with the month label + year, then that month's day sections. */
function MonthBlock({ month, index, t }) {
  const monthDelay = Math.min(index * 0.05, 0.2);
  return (
    <Reveal as="section" y={18} amount={0.2} delay={monthDelay} className="relative">
      <header
        className="relative flex items-center gap-4 mb-7 mt-12 first:mt-0"
        style={{ paddingLeft: "calc(var(--spine-x) + 2.75rem)" }}
      >
        {/* 月 marker — a gold-ringed disc straddling the spine. The disc sits
         *  centred on `--spine-x`; the ring + glyph carry gold (value/rule
         *  hue). Pure decoration apart from its label. */}
        <span
          aria-hidden
          className="absolute top-1/2 grid place-items-center w-9 h-9 rounded-full -translate-y-1/2 ja text-base"
          style={{
            left: "calc(var(--spine-x) - 1.125rem)",
            color: "var(--color-or)",
            background: "var(--color-noir-deep)",
            border: "1px solid color-mix(in oklab, var(--color-or) 55%, transparent)",
            boxShadow:
              "0 0 18px -6px color-mix(in oklab, var(--color-or) 70%, transparent), inset 0 1px 0 color-mix(in oklab, var(--color-or) 18%, transparent)",
          }}
        >
          月
        </span>
        <h2 className="display text-2xl md:text-3xl text-[var(--color-ivoire)] leading-none whitespace-nowrap">
          {month.label}
          {month.year ? (
            <sup className="text-[0.5em] italic text-[var(--color-or-pale)] ml-1.5 tracking-normal align-super">
              {month.year}
            </sup>
          ) : null}
        </h2>
        {/* A short gold rule trailing off the month label — adds horizon to
         *  an otherwise flat divider. Theme-var gradient, hidden on phones. */}
        <span
          aria-hidden
          className="pointer-events-none hidden sm:block h-px flex-1 self-center"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--color-or) 40%, transparent), transparent)",
          }}
        />
        <span className="label-mono text-[var(--color-or-pale)]/70 whitespace-nowrap">
          {month.count}&nbsp;{t("activity.day.events")}
        </span>
      </header>

      {month.days.map((day, i) => (
        <DaySection key={day.key} day={day} index={i} t={t} />
      ))}
    </Reveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Day section — a dated node on the spine + the day's entries

function DaySection({ day, index, t }) {
  // Stagger each day's reveal down the timeline, capped so a long history
  // never leaves the bottom days waiting too long. GPU-only (opacity/transform)
  // via the shared Reveal — reduced-motion renders a plain element.
  const dayDelay = Math.min(index * 0.04, 0.2);
  return (
    <Reveal as="div" y={16} amount={0.15} delay={dayDelay} className="relative mb-6">
      {/* Dated node — the day's number set on the spine inside a small gold
       *  ring, with the relative label ("Aujourd'hui") + full date beside it. */}
      <header
        className="relative flex items-baseline gap-3 mb-3"
        style={{ paddingLeft: "calc(var(--spine-x) + 2.75rem)" }}
      >
        <span
          aria-hidden
          className="absolute top-0 grid place-items-center w-8 h-8 rounded-full figural text-sm leading-none"
          style={{
            left: "calc(var(--spine-x) - 1rem)",
            color: "var(--color-or-pale)",
            background: "var(--color-noir)",
            border:
              "1px solid color-mix(in oklab, var(--color-or) 32%, transparent)",
          }}
        >
          {day.date.day}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          {day.relative ? (
            <span className="display italic text-[11px] uppercase tracking-[0.32em] text-[var(--color-or)]">
              {t(day.relative)}
            </span>
          ) : null}
          <span className="micro-tight text-[var(--color-ivoire-soft)]/70 normal-case tracking-[0.18em]">
            {day.date.weekday}
          </span>
        </div>
      </header>

      <ol style={{ paddingLeft: "calc(var(--spine-x) + 2.75rem)" }}>
        {day.events.map((ev, i) => (
          <Entry key={ev.id} ev={ev} index={i} t={t} />
        ))}
      </ol>
    </Reveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry — one event hung off the spine with its own kanji node

function Entry({ ev, index = 0, t }) {
  const meta = KIND_META[ev.kind];
  const time = new Date(ev.created_at);
  const figureId = ev.payload?.figure_id;
  const figureName = ev.payload?.figure_name;
  const figureImage = ev.payload?.figure_image;
  // This kind's colour signature, exposed as a single `--accent` custom
  // property the decorative elements below reference. Pure styling.
  const accent = kindAccent(ev.kind);
  // Cascade entries within a day, capped so a busy day stays snappy.
  const revealDelay = Math.min(index * 0.04, 0.2);

  return (
    <Reveal
      as="li"
      y={14}
      amount={0.4}
      delay={revealDelay}
      className="group relative py-3.5 border-b border-dashed last:border-b-0"
      style={{
        "--accent": accent,
        borderColor: "color-mix(in oklab, var(--color-or) 14%, transparent)",
      }}
    >
      {/* Kanji node on the spine — a small disc inked in this kind's hue,
       *  centred on `--spine-x`. Brightens + lifts a touch on hover
       *  (opacity/transform only). The connector hairline reaches from the
       *  node to the row. Decorative, theme-var driven. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-3.5 grid place-items-center w-7 h-7 rounded-full ja text-[15px] leading-none transition-transform duration-300 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none"
        style={{
          // Pull the node back onto the spine: this <li> is already indented
          // to (spine-x + 2.75rem), so step left by that whole offset and
          // re-centre the 1.75rem disc on the rule.
          left: "calc(-2.75rem - 0.875rem)",
          color: accent,
          background: "var(--color-noir)",
          border: `1px solid color-mix(in oklab, ${accent} 55%, transparent)`,
          boxShadow: `0 0 14px -5px color-mix(in oklab, ${accent} 75%, transparent)`,
        }}
      >
        {meta?.kanji ?? "・"}
        {/* Sentiment pip riding the node corner — gold/laque/ivoire dot. */}
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
          style={{
            background:
              meta?.tone === "positive"
                ? "var(--color-or)"
                : meta?.tone === "negative"
                  ? "var(--color-laque-bright)"
                  : "var(--color-ivoire)",
            boxShadow: "0 0 0 1px var(--color-noir)",
          }}
        />
      </span>

      {/* Connector — a short hairline from the spine to the node, in the
       *  kind's hue, that brightens on hover. Opacity-only transition. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-[1.55rem] h-px opacity-60 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none"
        style={{
          left: "calc(-1.875rem)",
          width: "1.125rem",
          background: `linear-gradient(90deg, color-mix(in oklab, ${accent} 55%, transparent), transparent)`,
        }}
      />

      {/* Hover colour-wash — a faint accent bloom from the node corner that
       *  fades in on hover, giving each row a moment of its own colour without
       *  disturbing the resting layout. Opacity-only transition. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none motion-reduce:group-hover:opacity-0"
        style={{
          background: `radial-gradient(60% 80% at 0% 50%, color-mix(in oklab, ${accent} 9%, transparent), transparent 62%)`,
        }}
      />

      <div className="relative min-w-0">
        <p
          className="text-sm text-[var(--color-ivoire)] leading-relaxed pr-14"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <EntryLine ev={ev} t={t} figureId={figureId} figureName={figureName} />
        </p>

        {/* Slipped preorder — pin a paper-tape annotation showing from → to */}
        {ev.kind === "preorder_slipped" ? (
          <SlipTape from={ev.payload?.from_date} to={ev.payload?.to_date} />
        ) : null}

        {/* Status transition — two pills with an arrow between them */}
        {ev.kind === "preorder_status_changed" ? (
          <StatusArrow
            from={ev.payload?.from_status}
            to={ev.payload?.to_status}
            t={t}
          />
        ) : null}

        <span
          className="block mt-1.5 text-[10px] uppercase tracking-[0.22em]"
          style={{
            fontFamily: "var(--font-mono)",
            color: "color-mix(in oklab, var(--color-ivoire) 45%, transparent)",
          }}
        >
          <time
            dateTime={ev.created_at}
            title={time.toLocaleString(document.documentElement.lang || undefined)}
          >
            {formatTimeOfDay(time)} · {relativeShort(time)}
          </time>
        </span>

        {figureImage ? (
          <Link
            to={figureId ? `/figures/${figureId}` : "#"}
            className="absolute top-0 right-0 block w-12 h-12 overflow-hidden bg-[var(--color-noir-deep)] opacity-0 -translate-x-2 transition-[opacity,transform] duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0 motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-x-0"
            style={{
              border: "1px solid color-mix(in oklab, var(--color-or) 25%, transparent)",
            }}
            aria-label={figureName}
          >
            <img
              src={figureImage}
              alt={figureName ?? ""}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </Link>
        ) : null}
      </div>
    </Reveal>
  );
}

/** The typeset event description. The figure name is wrapped in <strong>
 *  (restyled to a display serif inline) and linked to the figure detail page
 *  when we know the id. */
function EntryLine({ ev, t, figureId, figureName }) {
  const wrap = (children) =>
    figureId ? (
      <Link
        to={`/figures/${figureId}`}
        className="underline decoration-[var(--color-or)]/25 hover:decoration-[var(--color-or)] underline-offset-4 transition-colors"
      >
        {children}
      </Link>
    ) : (
      children
    );

  const name = (
    <strong
      className="font-normal text-[17px] tracking-[0.005em] text-[var(--color-or-pale)] group-hover:text-[var(--color-or)] transition-colors"
      style={{ fontFamily: "var(--font-display)" }}
    >
      {figureName ?? t("activity.unknown_figure")}
    </strong>
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
        <p className="micro-tight mt-3 opacity-80">{t("activity.empty.body")}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping + formatting

/** Headline counts for the StatCard strip — all figurine-domain metrics drawn
 *  from the loaded activity window (no manga completion). */
function deriveStats(events) {
  let acquired = 0;
  let preorders = 0;
  let thisMonth = 0;
  const now = new Date();
  const ym = now.getFullYear() * 12 + now.getMonth();
  for (const e of events) {
    if (ACQUIRED_KINDS.has(e.kind)) acquired += 1;
    if (PREORDER_KINDS.has(e.kind)) preorders += 1;
    const d = new Date(e.created_at);
    if (d.getFullYear() * 12 + d.getMonth() === ym) thisMonth += 1;
  }
  return { total: events.length, acquired, preorders, thisMonth };
}

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
          month: d.toLocaleDateString(document.documentElement.lang || undefined, { month: "long" }),
          year: d.getFullYear(),
          weekday: d.toLocaleDateString(document.documentElement.lang || undefined, { weekday: "long" }),
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

/** Thread the day buckets into calendar months for the spine's month markers.
 *  Returns [{ key, label, year, count, days: [] }] in the same chronological
 *  order as the input days (most recent month first). */
function groupByMonth(days) {
  const months = [];
  const idxByKey = new Map();
  for (const day of days) {
    const d = day.date.raw;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let i = idxByKey.get(key);
    if (i === undefined) {
      i = months.length;
      idxByKey.set(key, i);
      const label = day.date.month;
      months.push({
        key,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        year: d.getFullYear(),
        count: 0,
        days: [],
      });
    }
    months[i].days.push(day);
    months[i].count += day.events.length;
  }
  return months;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatTimeOfDay(d) {
  return d.toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "il y a 3 h" — tight relative formatter for the entry margin. */
function relativeShort(d) {
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  const en =
    typeof document !== "undefined" &&
    (document.documentElement.lang || "").startsWith("en");
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}${en ? "d" : "j"}`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo`;
  const y = Math.floor(diff / 86400 / 365);
  return en ? `${y}y` : `${y} an${y >= 2 ? "s" : ""}`;
}
