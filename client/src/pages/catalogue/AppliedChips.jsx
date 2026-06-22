import { X } from "lucide-react";

/**
 * The removable applied-filter chips above the results grid, plus "Tout
 * effacer". The orchestrator flattens its active filters into a list of
 * `{ id, kind, label, onRemove }` descriptors; this renders them and the
 * clear-all action. Each chip's ✕ removes exactly that filter; clear-all wipes
 * the query and every facet at once.
 *
 * Renders nothing when there are no active filters (the bar disappears).
 */
export default function AppliedChips({ t, chips, onClearAll }) {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="cat-applied" aria-label={t("browse.facets.applied", { default: "Filtres appliqués" })}>
      <span className="cat-applied-lead">{t("browse.facets.filters", { default: "Filtres" })}</span>
      {chips.map((c) => (
        <span key={c.id} className="cat-achip">
          {c.kind ? <span className="cat-achip-k">{c.kind}</span> : null}
          {c.label}
          <button
            type="button"
            className="cat-achip-x"
            aria-label={t("browse.facets.remove_filter", {
              default: "Retirer le filtre {label}",
              label: c.label,
            })}
            onClick={c.onRemove}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" className="cat-applied-clear" onClick={onClearAll}>
        {t("browse.facets.clear_all", { default: "Tout effacer" })}
      </button>
    </div>
  );
}
