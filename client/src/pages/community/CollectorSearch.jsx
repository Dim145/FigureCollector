import { Search } from "lucide-react";
import { Input } from "../../components/ui/index.js";

/**
 * The collector directory search field — a labelled, tokenised <Input> with a
 * leading search glyph and a live result count beside it. Controlled by the
 * page (debounce + query live in the orchestrator). ≥44px target via Input's
 * default size; the visible label keeps it accessible.
 */
export default function CollectorSearch({ value, onChange, count, t }) {
  const labelId = "collector-search-label";
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap w-full">
      <label className="flex-1 min-w-[220px] max-w-[30rem] block">
        <span id={labelId} className="micro mb-2 block">
          {t("discover.search_label", { default: "Chercher" })}
        </span>
        <span className="relative block">
          <Search
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-subtle)] pointer-events-none"
          />
          <Input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("discover.search")}
            aria-label={t("discover.search")}
            className="pl-9"
          />
        </span>
      </label>
      <p
        role="status"
        aria-live="polite"
        className="micro flex items-baseline gap-2 pb-3 whitespace-nowrap"
      >
        <b className="figural not-italic text-2xl leading-none text-[var(--accent)] tabular-nums">
          {count}
        </b>
        <span className="normal-case tracking-normal text-[var(--on-surface-muted)]">
          {t("discover.count")}
        </span>
      </p>
    </div>
  );
}
