import { Search, X } from "lucide-react";
import Select from "../../components/Select.jsx";
import DensityControl from "../../components/DensityControl.jsx";

/** Sort keys, in menu order. `recent` mirrors the previous implicit order. */
export const SORTS = ["recent", "name", "value", "gain", "purchase"];

/**
 * Working bar for the collection plate: filter by text, sort, choose density,
 * and see how much of the shelf is currently on screen.
 *
 * The catalogue has had a search station and four sorts since 0.35; the
 * collection — the bigger, more repetitive list — had neither, so "the
 * Nendoroid I bought in spring" or "what gained the most" could only be
 * answered by eye. This reuses the catalogue's primitives rather than
 * inventing a second grammar.
 */
export default function CollectionToolbar({
  t,
  q,
  onQ,
  sort,
  onSort,
  density,
  onDensity,
  shown,
  total,
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative flex-1 min-w-[14rem]">
        <label htmlFor="collection-q" className="micro block mb-2">
          {t("collection.search.label")}
        </label>
        <Search
          aria-hidden
          size={16}
          className="absolute left-3 top-[calc(50%+0.6rem)] -translate-y-1/2 text-[var(--color-or)] pointer-events-none"
        />
        <input
          id="collection-q"
          type="search"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder={t("collection.search.placeholder")}
          className="w-full min-h-[44px] pl-9 pr-9 bg-[var(--surface-sunken)] text-[var(--color-ivoire)] placeholder:text-[var(--color-ivoire-soft)]/60"
          style={{
            border: "1px solid color-mix(in oklab, var(--color-or) 30%, transparent)",
            borderRadius: "var(--radius-sm)",
          }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => onQ("")}
            aria-label={t("collection.noresult.clear")}
            className="absolute right-1 top-[calc(50%+0.6rem)] -translate-y-1/2 grid place-items-center w-9 h-9 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
          >
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </div>

      <Select
        label={t("collection.sort.label")}
        value={sort}
        onChange={onSort}
        className="min-w-[11rem]"
        options={SORTS.map((s) => ({ value: s, label: t(`collection.sort.${s}`) }))}
      />

      <div className="flex flex-col gap-2">
        <span className="micro">{t("plate.density.label")}</span>
        <DensityControl value={density} onChange={onDensity} />
      </div>

      {/* Position line — "how much of the shelf am I looking at". aria-live so
          a filter change is announced rather than silently re-rendering. */}
      <p
        className="micro tabular-nums ml-auto self-center text-[var(--color-ivoire-soft)]"
        aria-live="polite"
      >
        {t("collection.pos", { shown, total })}
      </p>
    </div>
  );
}
