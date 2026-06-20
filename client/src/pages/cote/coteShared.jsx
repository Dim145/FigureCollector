import { Link } from "react-router-dom";
import { Button, EmptyState } from "../../components/ui/index.js";
import { Skeleton } from "../../components/Skeleton.jsx";

/**
 * Page-local shared bits for « La Cote » (valuation): the zero-data empty
 * state, a bespoke loading skeleton that mirrors the page's silhouette (stat
 * strip → ranking table), and the small pure helpers the orchestrator + the
 * ranking table share (row shaping, sort comparators).
 */

/** No pieces to value yet — distinct from "pieces exist but none priced". */
export function CoteEmpty({ t }) {
  return (
    <EmptyState
      kanji="価"
      eyebrow={t("cote.empty.eyebrow", { default: "VALORISATION" })}
      title={t("cote.empty.title", { default: "Rien à coter pour l'instant" })}
      body={t("cote.empty", {
        default: "Aucune pièce à évaluer pour l'instant.",
      })}
    >
      <Button as={Link} to="/catalogue" variant="primary">
        {t("cote.empty_cta", { default: "Parcourir le catalogue" })}
      </Button>
    </EmptyState>
  );
}

/** In-flow loader sized like the real layout (stat strip + table rows). */
export function CoteLoading({ t }) {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">{t("a11y.loading", { default: "Chargement…" })}</span>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-sm" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

// ── Ranking helpers ─────────────────────────────────────────────────────────

/**
 * One ranked row: the owned item + its resolved current value (`ev`), the
 * purchase price (`paid`), and the same-currency plus-value (`delta` abs / pct)
 * — null when value and price are in different currencies (no FX at the row
 * level; the headline strip carries the converted total instead).
 */
export function coteRow(o, ev, paid) {
  const sameCur = ev && paid && ev.currency === paid.currency;
  const deltaAbs = sameCur ? ev.amount - paid.amount : null;
  const deltaPct = deltaAbs != null && paid.amount > 0 ? (deltaAbs / paid.amount) * 100 : null;
  return { o, ev, paid, deltaAbs, deltaPct };
}

/** Sort keys the ranking table exposes. Default is value desc (the headline). */
export const COTE_SORT_KEYS = ["name", "value", "paid", "delta", "deltaPct"];

/** Comparator factory for a `{ key, dir }` sort over `coteRow` shapes. */
export function coteComparator({ key, dir }) {
  const s = dir === "asc" ? 1 : -1;
  // Nulls always sink to the bottom regardless of direction so unpriced /
  // unpaid rows never crowd the top.
  const num = (v) => (v == null || Number.isNaN(v) ? null : v);
  return (a, b) => {
    if (key === "name") {
      return s * (a.o.figure_name || "").localeCompare(b.o.figure_name || "");
    }
    const pick =
      key === "value"
        ? (r) => num(r.ev?.amount)
        : key === "paid"
          ? (r) => num(r.paid?.amount)
          : key === "deltaPct"
            ? (r) => num(r.deltaPct)
            : (r) => num(r.deltaAbs);
    const av = pick(a);
    const bv = pick(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return s * (av - bv);
  };
}
