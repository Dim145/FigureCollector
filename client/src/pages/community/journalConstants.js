/**
 * Shared model + formatters for the Journal (ActivityPage) and its page-local
 * sub-components. Each event kind carries its visual treatment; all colours are
 * theme `var()`s so the palette flips light/dark and stays on Direction A.
 */

/** Six event kinds with their visual treatment.
 *  kanji   — calligraphic mark for the row node
 *  tone    — sentiment pip ("positive" / "negative" / "neutral")
 *  accent  — a theme CSS var giving each kind its own colour signature */
export const EVENT_KINDS = [
  { id: "owned_added", kanji: "入", tone: "positive", accent: "var(--color-jade)" },
  { id: "owned_removed", kanji: "退", tone: "negative", accent: "var(--color-laque-bright)" },
  { id: "preorder_created", kanji: "予", tone: "neutral", accent: "var(--color-indigo)" },
  { id: "preorder_slipped", kanji: "滑", tone: "negative", accent: "var(--color-neon-amber)" },
  { id: "preorder_status_changed", kanji: "状", tone: "neutral", accent: "var(--color-neon-cyan)" },
  { id: "preorder_received", kanji: "受", tone: "positive", accent: "var(--color-or)" },
];

export const KIND_META = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k]));

/** The accent for an event kind, falling back to gold (always on-brand). */
export function kindAccent(kind) {
  return KIND_META[kind]?.accent ?? "var(--color-or)";
}

/** The sentiment pip colour for a kind. */
export function toneColor(tone) {
  if (tone === "positive") return "var(--accent)";
  if (tone === "negative") return "var(--danger)";
  return "var(--on-surface-muted)";
}

/** Kinds that read as "acquisitions" (a piece entering the collection). */
const ACQUIRED_KINDS = new Set(["owned_added", "preorder_received"]);
/** Kinds that touch a preorder's lifecycle. */
const PREORDER_KINDS = new Set([
  "preorder_created",
  "preorder_slipped",
  "preorder_status_changed",
  "preorder_received",
]);

/** Headline counts for the StatCard strip — all figurine-domain metrics drawn
 *  from the loaded activity window (no manga completion). */
export function deriveStats(events) {
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

function lang() {
  return (typeof document !== "undefined" && document.documentElement.lang) || undefined;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Bucket the chronological event list by calendar day. Returns
 *  [{ key, date:{day,month,year,weekday,full,raw}, events, relative }] in the
 *  same order as the input (most recent first). The first few days are
 *  annotated with relative-label i18n keys ("today" / "yesterday" / this week). */
export function groupByDay(events) {
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
          month: d.toLocaleDateString(lang(), { month: "long" }),
          year: d.getFullYear(),
          weekday: d.toLocaleDateString(lang(), { weekday: "long" }),
          full: d.toLocaleDateString(lang(), {
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
          raw: d,
        },
        events: [],
        relative: null,
      });
    }
    days[i].events.push(ev);
  }
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

/** "14:32" — locale time-of-day for an entry. */
export function formatTimeOfDay(d) {
  return d.toLocaleTimeString(lang(), { hour: "2-digit", minute: "2-digit" });
}

/** "il y a 3 h" → compact relative formatter for the entry margin. */
export function relativeShort(d) {
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  const en = (lang() || "").startsWith("en");
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}${en ? "d" : "j"}`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo`;
  const y = Math.floor(diff / 86400 / 365);
  return en ? `${y}y` : `${y} an${y >= 2 ? "s" : ""}`;
}
