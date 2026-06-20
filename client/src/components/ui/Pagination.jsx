import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Page navigation for tables / grids. 1-indexed. Collapses long ranges with
 * ellipses (always shows first, last, and ±1 around the current page).
 */
export default function Pagination({ page = 1, pageCount = 1, onChange, className = "" }) {
  if (pageCount <= 1) return null;

  const go = (p) => {
    if (p >= 1 && p <= pageCount && p !== page) onChange?.(p);
  };

  const items = Array.from({ length: pageCount }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1)
    .reduce((acc, p) => {
      const prev = acc[acc.length - 1];
      return typeof prev === "number" && p - prev > 1 ? [...acc, "…", p] : [...acc, p];
    }, []);

  const btn =
    "inline-flex items-center justify-center min-w-9 h-9 px-2 text-sm border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <nav aria-label="Pagination" className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Page précédente"
        className={btn}
        style={{
          borderRadius: "var(--radius-sm)",
          borderColor: "var(--border)",
          color: "var(--on-surface-muted)",
        }}
      >
        <ChevronLeft size={16} />
      </button>
      {items.map((it, i) =>
        it === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-[var(--on-surface-subtle)]">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => go(it)}
            aria-current={it === page ? "page" : undefined}
            className={btn}
            style={{
              borderRadius: "var(--radius-sm)",
              borderColor: it === page ? "var(--accent)" : "var(--border)",
              color: it === page ? "var(--accent)" : "var(--on-surface-muted)",
              background:
                it === page ? "color-mix(in oklab, var(--accent) 10%, transparent)" : "transparent",
            }}
          >
            {it}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= pageCount}
        aria-label="Page suivante"
        className={btn}
        style={{
          borderRadius: "var(--radius-sm)",
          borderColor: "var(--border)",
          color: "var(--on-surface-muted)",
        }}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
