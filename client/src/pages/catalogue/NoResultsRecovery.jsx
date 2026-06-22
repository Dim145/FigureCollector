import { Link } from "react-router-dom";

/**
 * The FACETTES-mode no-results recovery panel. Shown when the active query +
 * facets produce zero figures. It keeps the search alive (the chips above stay
 * visible), offers per-filter removals + "Tout effacer", a "Saisie manuelle"
 * link to /figures/new, and a trending strip (the popular proxy) as fresh
 * starting points.
 *
 *   chips    — the same removable filters as above, surfaced as quick "Retirer …"
 *   trending — [{ label, count, onPick }] from the popular proxy
 */
export default function NoResultsRecovery({ t, query, chips, onClearAll, trending }) {
  return (
    <div className="cat-noresults" aria-label={t("browse.noresults.aria", { default: "Aucun résultat" })}>
      <span className="cat-nr-tag">
        <span className="ja" aria-hidden>
          空
        </span>
        {t("browse.noresults.tag", { default: "Aucun résultat" })}
      </span>
      <h2 className="display">
        <span className="cat-em">{t("browse.noresults.title_em", { default: "Aucune" })}</span>{" "}
        {t("browse.noresults.title_rest", { default: "figurine ne correspond" })}
      </h2>
      <p>
        {query ? (
          <>
            {t("browse.noresults.body_for", { default: "Rien pour" })}{" "}
            <span className="cat-nr-q">« {query} »</span>.{" "}
          </>
        ) : null}
        {t("browse.noresults.body_hint", {
          default:
            "Votre recherche est conservée — retirez un filtre, ou repartez d'une piste ci-dessous.",
        })}
      </p>

      <div className="cat-nr-actions">
        {chips.map((c) => (
          <button key={c.id} type="button" className="cat-nr-btn cat-nr-btn-keep" onClick={c.onRemove}>
            <span aria-hidden>✕</span>{" "}
            {t("browse.noresults.remove", { default: "Retirer {label}", label: c.label })}
          </button>
        ))}
        <button type="button" className="cat-nr-btn" onClick={onClearAll}>
          <span aria-hidden>⟲</span> {t("browse.facets.clear_all", { default: "Tout effacer" })}
        </button>
        <Link to="/figures/new" className="cat-nr-btn">
          <span aria-hidden>✎</span> {t("browse.noresults.manual", { default: "Saisie manuelle" })}
        </Link>
      </div>

      {trending && trending.length > 0 ? (
        <div className="cat-nr-trending">
          <div className="cat-nr-th">{t("browse.noresults.trending", { default: "Tendances en ce moment" })}</div>
          <div className="cat-nr-trend-chips">
            {trending.map((tr) => (
              <button key={tr.id} type="button" className="cat-fchip" onClick={tr.onPick}>
                {tr.label}
                <span className="cat-ct num">{tr.count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
