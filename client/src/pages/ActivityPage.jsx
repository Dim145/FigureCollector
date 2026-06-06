import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useActivity } from "../hooks/useActivity.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";

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
 *  accent  — a theme CSS var giving each kind its own colour signature; the
 *            margin spine, glyph ring and hover-wash all tone off this one
 *            value. Every entry is a `var()` so the palette flips light/dark.
 *  i18nKey — formatEntry uses this to look up the line wording */
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
  // Stagger each day's reveal down the timeline, capped so a long history
  // never leaves the bottom days waiting too long. GPU-only (opacity/transform)
  // via the shared Reveal — reduced-motion renders a plain element.
  const dayDelay = Math.min(index * 0.05, 0.25);
  return (
    <Reveal as="div" y={20} amount={0.15} delay={dayDelay}>
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
        {day.events.map((ev, i) => (
          <Entry key={ev.id} ev={ev} index={i} t={t} />
        ))}
      </ol>
    </Reveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry — one manuscript line

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
      y={16}
      amount={0.4}
      delay={revealDelay}
      className="entry group"
      style={{ "--accent": accent }}
    >
      {/* Margin spine — a thin colour-coded bar fused to the entry's left
       *  edge in this kind's hue, echoing the journal's gold thread. Widens +
       *  brightens on hover (transform/opacity only). Decorative,
       *  pointer-events-none, theme-var driven. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 w-[2px] origin-left scale-x-50 opacity-60 transition-[transform,opacity] duration-300 ease-out group-hover:scale-x-100 group-hover:opacity-100 motion-reduce:transition-none"
        style={{
          left: "calc(-1 * clamp(0px, 4vw, 2.5rem))",
          background: `linear-gradient(180deg, transparent, color-mix(in oklab, ${accent} 65%, transparent) 20%, color-mix(in oklab, ${accent} 40%, transparent) 80%, transparent)`,
        }}
      />
      {/* Hover colour-wash — a faint accent bloom from the glyph corner that
       *  fades in on hover, giving each row a moment of its own colour without
       *  disturbing the resting layout. Opacity-only transition. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none motion-reduce:group-hover:opacity-0"
        style={{
          background: `radial-gradient(60% 80% at 0% 50%, color-mix(in oklab, ${accent} 9%, transparent), transparent 62%)`,
        }}
      />
      <div
        className={`entry-glyph entry-glyph--${meta?.tone ?? "neutral"} relative`}
      >
        {/* Accent ring riding over the brass plate — fuses each glyph to its
         *  kind's hue and lights up on hover. GPU-cheap (opacity), theme var. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none"
          style={{
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 60%, transparent), 0 0 16px -6px color-mix(in oklab, ${accent} 80%, transparent)`,
          }}
        />
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
          <time dateTime={ev.created_at} title={time.toLocaleString(document.documentElement.lang || undefined)}>
            {formatTimeOfDay(time)} · {relativeShort(time)}
          </time>
        </span>

        {figureImage ? (
          <Link
            to={figureId ? `/figures/${figureId}` : "#"}
            className="entry-thumb"
            aria-label={figureName}
          >
            <img src={figureImage} alt={figureName ?? ""} loading="lazy" decoding="async" />
          </Link>
        ) : null}
      </div>
    </Reveal>
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
