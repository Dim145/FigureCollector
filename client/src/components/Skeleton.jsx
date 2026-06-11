import { useT } from "../i18n/index.jsx";

/**
 * Direction-A loading placeholders — noir blocks with a slow gold sweep
 * (`.fc-skel` in index.css; static under prefers-reduced-motion).
 *
 * `Skeleton` is one block; `PageSkeleton` is the shared full-page layout that
 * replaces the old bare "…" loaders: an editorial header ghost (kicker, title,
 * gold-rule) over a few content blocks, with a screen-reader announcement.
 */
export function Skeleton({ className = "" }) {
  return <span aria-hidden className={`fc-skel block ${className}`} />;
}

/** In-flow loader for a section below an already-rendered page header. */
export function SectionSkeleton({ blocks = 3 }) {
  const t = useT();
  return (
    <div role="status" aria-live="polite" className="py-8 space-y-4">
      <span className="sr-only">{t("a11y.loading", { default: "Chargement…" })}</span>
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? "h-32 w-full" : "h-20 w-full"} />
      ))}
    </div>
  );
}

export default function PageSkeleton({ blocks = 3, compact = false }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative max-w-6xl mx-auto px-6 ${compact ? "py-8" : "py-16"}`}
    >
      <span className="sr-only">{t("a11y.loading", { default: "Chargement…" })}</span>
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-10 w-72 mt-4" />
      <div className="gold-rule w-16 mt-5 opacity-40" />
      <div className="mt-10 space-y-4">
        {Array.from({ length: blocks }, (_, i) => (
          <Skeleton key={i} className={i === 0 ? "h-40 w-full" : "h-20 w-full"} />
        ))}
      </div>
    </div>
  );
}
