/**
 * "Explorer par fabricant & série" — the discovery bento. A featured maker cell
 * (the busiest manufacturer) spans two rows, followed by the next makers as
 * compact tiles. Each tile selects that manufacturer as a facet (driving the
 * results-mode filter server-side), so the bento is the editorial entry point
 * into the systematic facet results.
 *
 * Pure presentation + an `onPick(name)` callback; the orchestrator turns the
 * pick into an active manufacturer facet. GPU-light: a static radial wash on
 * the feature cell and a faint kanji watermark, no blur/glow.
 */
export default function ExploreBento({ manufacturers, onPickManufacturer, onSeeAll, t }) {
  const makers = manufacturers ?? [];
  if (makers.length === 0) return null;
  const [feat, ...rest] = makers;
  const tiles = rest.slice(0, 4);
  const initial = (name) => (name ? name.trim().charAt(0).toUpperCase() : "·");

  return (
    <section aria-label={t("browse.discover.explore_title", { default: "Explorer par fabricant" })}>
      <div className="cat-section-head">
        <span className="ja cat-section-kanji" aria-hidden>
          蔵
        </span>
        <h2 className="cat-section-title display">
          <span className="cat-em">{t("browse.discover.explore_em", { default: "Explorer" })}</span>{" "}
          {t("browse.discover.explore_rest", { default: "par fabricant & série" })}
        </h2>
        <button type="button" className="cat-section-more" onClick={onSeeAll}>
          {t("browse.discover.all_makers", { default: "Tous les fabricants" })} →
        </button>
      </div>

      <div className="cat-bento">
        <button
          type="button"
          className="cat-bento-tile cat-bento-feat"
          onClick={() => onPickManufacturer(feat.name)}
        >
          <span className="cat-bento-badge">
            {t("browse.discover.featured_studio", { default: "Studio en vedette" })}
          </span>
          <span className="ja cat-bento-wmk" aria-hidden>
            {initial(feat.name)}
          </span>
          <span className="cat-bento-kk">{t("figure.spec.manufacturer", { default: "Fabricant" })}</span>
          <span className="cat-bento-nm">{feat.name}</span>
          <span className="cat-bento-ct num">
            {feat.count} {t("browse.discover.figures", { default: "figurines" })}{" "}
            <span className="cat-arr" aria-hidden>
              →
            </span>
          </span>
        </button>

        {tiles.map((m) => (
          <button
            key={m.id ?? m.slug ?? m.name}
            type="button"
            className="cat-bento-tile"
            onClick={() => onPickManufacturer(m.name)}
          >
            <span className="ja cat-bento-wmk" aria-hidden>
              {initial(m.name)}
            </span>
            <span className="cat-bento-kk">
              {t("figure.spec.manufacturer", { default: "Fabricant" })}
            </span>
            <span className="cat-bento-nm">{m.name}</span>
            <span className="cat-bento-ct num">
              {m.count} {t("browse.discover.figures", { default: "figurines" })}{" "}
              <span className="cat-arr" aria-hidden>
                →
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
