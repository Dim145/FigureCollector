// Page-local lifecycle vocabulary + accent/date helpers for the Horarium.
//
// STYLING NOTE: every accent value is a theme CSS var so the whole palette
// flips with the light/dark theme. The page exposes each entry's colour as a
// single `--accent` custom property (see `accentVars`) so borders, seals,
// chips and washes all tone together off one variable. Hanko red stays the
// single hot accent (urgency / loss); gold stays value/money — these helpers
// only colour the lifecycle key, never the chrome.

import { appLocale } from "../../lib/locale.js";

/** Lifecycle states accepted by the server, in chronological order. */
export const STATUS_OPTIONS = [
  "announced",
  "preorder_open",
  "preordered",
  "in_production",
  "released",
  "shipped",
  "received",
  "cancelled",
];

/** Kanji glyph for each lifecycle state — used in seals + filter chips. */
export const STATUS_KANJI = {
  announced: "公", // publish / make public
  preorder_open: "開", // open
  preordered: "約", // contract / promise
  in_production: "製", // manufacture
  released: "発", // depart / release
  shipped: "送", // send
  received: "受", // receive
  cancelled: "止", // halt
};

/**
 * Lifecycle → accent colour (STYLING ONLY). Early states glow indigo (the
 * "nuit" of anticipation), the open/announce window leans gold, production
 * warms to amber, shipping turns cyan (in motion), receipt settles to jade
 * (in hand), and cancellation falls to laque red.
 */
const STATUS_ACCENT = {
  announced: "var(--color-indigo)",
  preorder_open: "var(--color-or)",
  preordered: "var(--color-or-pale)",
  in_production: "var(--color-neon-amber)",
  released: "var(--color-neon-amber)",
  shipped: "var(--color-neon-cyan)",
  received: "var(--color-jade)",
  cancelled: "var(--color-laque-bright)",
};

/** The accent for a given lifecycle status (falls back to gold). */
export function statusAccent(status) {
  return STATUS_ACCENT[status] ?? "var(--color-or)";
}

/** Resolve a status' accent, nudging imminent (≤14d, still-coming) releases
 *  to neon-amber regardless of status — "it's almost here" is the more urgent
 *  signal than the lifecycle slot. */
export function resolveAccent(status, imminent) {
  return imminent && status !== "cancelled" && status !== "received"
    ? "var(--color-neon-amber)"
    : statusAccent(status);
}

/** YYYY-MM-DD for today in the local timezone. */
export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Group entries by YYYY-MM. Returns [{ key, label, year, entries: [] }]. */
export function groupByMonth(entries, t) {
  const map = new Map();
  for (const p of entries) {
    const date = p.release_date_current ?? p.release_date_original ?? null;
    const key = date ? date.slice(0, 7) : "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.entries()].map(([key, list]) => {
    if (key === "unknown") {
      return {
        key,
        label: t("preorders.month.unknown"),
        year: null,
        entries: list,
      };
    }
    const [y, m] = key.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    // Localised month name (FR-first via the user's locale; works for EN too).
    const label = d.toLocaleDateString(appLocale(), { month: "long" });
    return {
      key,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      year: y,
      entries: list,
    };
  });
}

/**
 * Human-readable countdown for a YYYY-MM-DD release date.
 *   { label, imminent, past, unknown }
 */
export function countdownInfo(dateStr, t) {
  if (!dateStr) {
    return {
      label: t("preorders.countdown.unknown"),
      imminent: false,
      past: false,
      unknown: true,
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const msPerDay = 86400000;
  const diffDays = Math.round((target - today) / msPerDay);

  if (diffDays === 0) {
    return { label: t("preorders.countdown.today"), imminent: true, past: false, unknown: false };
  }
  if (diffDays === 1) {
    return {
      label: t("preorders.countdown.tomorrow"),
      imminent: true,
      past: false,
      unknown: false,
    };
  }
  if (diffDays > 0) {
    if (diffDays <= 14) {
      return {
        label: t("preorders.countdown.days", { n: diffDays }),
        imminent: true,
        past: false,
        unknown: false,
      };
    }
    if (diffDays <= 60) {
      const weeks = Math.round(diffDays / 7);
      return {
        label: t("preorders.countdown.weeks", { n: weeks }),
        imminent: false,
        past: false,
        unknown: false,
      };
    }
    const months = Math.round(diffDays / 30);
    return {
      label: t("preorders.countdown.months", { n: months }),
      imminent: false,
      past: false,
      unknown: false,
    };
  }
  const absDays = -diffDays;
  if (absDays < 60) {
    return {
      label: t("preorders.countdown.past_days", { n: absDays }),
      imminent: false,
      past: true,
      unknown: false,
    };
  }
  const months = Math.round(absDays / 30);
  return {
    label: t("preorders.countdown.past_months", { n: months }),
    imminent: false,
    past: true,
    unknown: false,
  };
}

/**
 * Stats for the ribbon. Returns { total, next, inTransit, depositsByCcy,
 * balanceByCcy } where the money maps are { CCY: number } so the ribbon can
 * render one <Money> per currency without ever cross-converting at this layer
 * (presentation conversion is the <Money>/DisplayCurrency layer's job).
 *
 *   deposits = sum of deposit_amount over still-committed preorders
 *              (not received, not cancelled).
 *   balance  = sum of max(price_amount - deposit_amount, 0) over the same set
 *              — i.e. what is still owed on pieces that haven't landed.
 */
export function deriveStats(sorted, t) {
  const total = sorted.length;
  const inTransit = sorted.filter((p) => p.status === "shipped").length;

  // The "next release" is the soonest non-received, non-cancelled item with a
  // future/today release date. Falls back to the nearest such item otherwise.
  const upcoming = sorted.find((p) => {
    if (p.status === "received" || p.status === "cancelled") return false;
    const d = p.release_date_current;
    if (!d) return false;
    return d >= todayISO();
  });
  const fallback = !upcoming
    ? sorted.find((p) => p.status !== "received" && p.status !== "cancelled")
    : null;
  const candidate = upcoming ?? fallback;
  const next = candidate
    ? {
        title: candidate.figure_name,
        label: countdownInfo(candidate.release_date_current, t).label,
      }
    : null;

  const depositsByCcy = {};
  const balanceByCcy = {};
  for (const p of sorted) {
    if (p.status === "received" || p.status === "cancelled") continue;
    const ccy = (p.price_currency || "EUR").toUpperCase();
    const deposit = Number(p.deposit_amount);
    const price = Number(p.price_amount);
    if (Number.isFinite(deposit) && deposit > 0) {
      depositsByCcy[ccy] = (depositsByCcy[ccy] ?? 0) + deposit;
    }
    // A settled balance (balance_paid_at set) owes nothing further — exclude it
    // from "Solde à régler" so the ribbon matches the per-entry view
    // (PreorderTimeline already treats balance_paid_at as paid-off). Without
    // this, marking a balance paid cleared the entry but left the aggregate
    // still counting it as owed.
    if (!p.balance_paid_at && Number.isFinite(price) && price > 0) {
      const paid = Number.isFinite(deposit) && deposit > 0 ? deposit : 0;
      const owed = Math.max(price - paid, 0);
      if (owed > 0) balanceByCcy[ccy] = (balanceByCcy[ccy] ?? 0) + owed;
    }
  }

  return { total, next, inTransit, depositsByCcy, balanceByCcy };
}
