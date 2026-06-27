// Shared formatters + lifecycle tokens for the admin Tasks console.
//
// Extracted from the old AdminTasksPage so the page table AND the detail drawer
// render state, timings and result summaries identically. Pure functions +
// constants only — no JSX, no React — so this stays a leaf module.
//
// Every colour is a Direction-A theme CSS var so the palette flips with the
// light/dark theme: jade = done (ready), gold = running (processing),
// laque = failed, ivoire = queued (pending).

export const JADE = "var(--color-jade)";
export const OR = "var(--color-or)";
export const LAQUE = "var(--color-laque-bright)";
export const IVOIRE = "var(--color-ivoire)";

// Status → accent token (STYLING ONLY).
export const STATE_TONE = {
  pending: IVOIRE,
  processing: OR,
  ready: JADE,
  failed: LAQUE,
};

// Kanji marker per lifecycle slot — echoes the seal language of the Horarium.
//   待 wait · 動 move/run · 済 settled/done · 否 deny/fail.
export const STATE_KANJI = {
  pending: "待",
  processing: "動",
  ready: "済",
  failed: "否",
};

// Badge tone name (from the shared <Badge> primitive) per lifecycle state, so
// the table cell can lean on the semantic primitive instead of inline colour.
export const STATE_BADGE_TONE = {
  pending: "neutral",
  processing: "warning",
  ready: "success",
  failed: "danger",
};

export function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** "il y a 6 s / 4 min / 2 h / 3 j" — coarse relative time. */
export function rel(iso, t) {
  if (!iso) return "";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return t("admin.tasks.ago.s", { n: Math.floor(sec) });
  if (sec < 3600) return t("admin.tasks.ago.m", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("admin.tasks.ago.h", { n: Math.floor(sec / 3600) });
  return t("admin.tasks.ago.d", { n: Math.floor(sec / 86400) });
}

/** Milliseconds between two ISO timestamps, or null when either is missing /
 *  the span is negative (clock skew). */
export function durationMs(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms >= 0 ? ms : null;
}

/** A raw ms span → "Xm Ys" / "Ys" / "Xms". Pairs with durationMs above. */
export function fmtDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

/** Execution time from claim→finish (ISO in, "Xm Ys" / "Ys" out). Kept as a
 *  named export because callers passed the raw timestamps before. */
export function execTime(start, finished) {
  return fmtDuration(durationMs(start, finished));
}

// server_job_runs.result keys with a localized "{n} …" label. Anything not
// listed renders as a raw `key: value` so new job summaries stay visible
// without a frontend release. `keep` is config (not an outcome) — skipped.
export const RESULT_LABELLED = new Set([
  "processed",
  "updated",
  "filled",
  "purged",
  "release_today",
  "release_j7",
  "delivery_today",
  "delivery_overdue",
  "indexed",
  "failed",
  "queued",
]);
export const RESULT_SKIP = new Set(["keep"]);

/** "127 figurines traitées · 42 prix mis à jour" from a result JSON. Zero
 *  counts are dropped; an all-zero run reads "aucune action nécessaire". */
export function formatJobResult(result, t) {
  if (!result || typeof result !== "object") return t("admin.tasks.result.nothing");
  const parts = [];
  for (const [k, v] of Object.entries(result)) {
    if (RESULT_SKIP.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) continue;
    parts.push(
      RESULT_LABELLED.has(k) ? t(`admin.tasks.result.k.${k}`, { n }) : `${k}: ${n}`,
    );
  }
  return parts.length ? parts.join(" · ") : t("admin.tasks.result.nothing");
}

// ── Service-health detail → a short, human line ───────────────────────────
// The /admin/services rows carry a free-form `detail` JSON blob whose shape
// varies per service (e.g. a queue driver reports
//   { active_jobs: 1, queues: { image: { pending: 0, processing: 0 },
//                               tags:  { pending: 3, processing: 0 } } }).
// Rather than dumping raw JSON in the tooltip we flatten it into
//   "1 job actif · tags 3 en attente"
// preferring meaningful nonzero leaves, and falling back to "clé: valeur".

// Leaf keys that read better as a count phrase than as "clé: valeur".
const SERVICE_LEAF_LABELLED = new Set([
  "active_jobs",
  "pending",
  "processing",
  "queued",
  "done",
  "failed",
]);

/** Is `v` a finite number we can phrase as a count? */
function asCount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** One leaf → a localized phrase. `prefix` names the queue/group it sits in
 *  (e.g. "tags") so sibling counts stay distinguishable. */
function serviceLeaf(prefix, key, n, t) {
  const label = SERVICE_LEAF_LABELLED.has(key)
    ? t(`admin.tasks.services.detail.${key}`, { n })
    : `${key}: ${n}`;
  return prefix ? `${prefix} ${label}` : label;
}

/** Walk one level of a detail object, emitting phrases for nonzero numeric
 *  leaves and recursing one level into nested groups (the queue map). Returns
 *  the count of nonzero leaves seen so the caller can decide on a fallback. */
function collectServiceParts(obj, t, parts, prefix = "") {
  let nonzero = 0;
  for (const [k, v] of Object.entries(obj)) {
    const n = asCount(v);
    if (n != null) {
      if (n !== 0) {
        parts.push(serviceLeaf(prefix, k, n, t));
        nonzero += 1;
      }
      continue;
    }
    if (v && typeof v === "object") {
      // Nested group (e.g. queues.tags) — prefix children with the group name.
      const childPrefix = prefix ? `${prefix} ${k}` : k;
      nonzero += collectServiceParts(v, t, parts, childPrefix);
      continue;
    }
    // A non-numeric scalar (string/bool) — surface it verbatim.
    if (v != null && v !== "") parts.push(prefix ? `${prefix} ${k}: ${v}` : `${k}: ${v}`);
  }
  return nonzero;
}

/** Turn a service-health `detail` blob into a short readable line. Returns
 *  `null` when there is nothing usable so the caller can fall back to the
 *  status label. Shows only meaningful nonzero leaves where possible; if every
 *  numeric leaf is zero it falls back to flat "clé: valeur" pairs so the
 *  tooltip still says *something* (e.g. "0 job actif"). */
export function formatServiceDetail(detail, t) {
  if (!detail || typeof detail !== "object") {
    return detail != null ? String(detail) : null;
  }
  const parts = [];
  const nonzero = collectServiceParts(detail, t, parts);
  if (nonzero > 0 && parts.length) return parts.join(" · ");

  // Nothing nonzero (an idle service): fall back to flat key: value pairs so
  // the tooltip is still informative rather than empty.
  const flat = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v && typeof v === "object") continue; // skip nested groups in the flat pass
    const n = asCount(v);
    flat.push(
      n != null && SERVICE_LEAF_LABELLED.has(k)
        ? t(`admin.tasks.services.detail.${k}`, { n })
        : `${k}: ${v}`,
    );
  }
  return flat.length ? flat.join(" · ") : null;
}
