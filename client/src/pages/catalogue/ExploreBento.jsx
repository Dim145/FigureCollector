import { useState } from "react";

/**
 * "Explorer par fabricant & série" — the discovery bento. A featured maker cell
 * (the busiest manufacturer) spans two rows, followed by the next makers as
 * compact tiles. Each tile selects that manufacturer as a facet (driving the
 * results-mode filter server-side), so the bento is the editorial entry point
 * into the systematic facet results.
 *
 * "Tous les fabricants" expands the bento in place to reveal every maker (it
 * does NOT pre-pick one); the button then collapses back. Pure presentation +
 * an `onPickManufacturer(name)` callback. GPU-light: a static radial wash on
 * the feature cell and a faint kanji watermark, no blur/glow.
 */
const COLLAPSED_TILES = 4;

export default function ExploreBento({ manufacturers, onPickManufacturer, t }) {
  const [showAll, setShowAll] = useState(false);
  const makers = manufacturers ?? [];
  if (makers.length === 0) return null;
  const [feat, ...rest] = makers;
  const tiles = showAll ? rest : rest.slice(0, COLLAPSED_TILES);
  const canExpand = rest.length > COLLAPSED_TILES;
  // The feature cell only spans 2 rows when there are ≥4 tiles to flank it;
  // with fewer makers a tall cell would leave a big void beneath it.
  const featTall = tiles.length >= COLLAPSED_TILES;
  const initial = (name) => (name ? name.trim().charAt(0).toUpperCase() : "·");
  const figuresLabel = (n) =>
    `${n} ${t("browse.discover.figures", { n, default: n > 1 ? "figurines" : "figurine" })}`;

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
        {canExpand ? (
          <button
            type="button"
            className="cat-section-more"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll
              ? t("browse.discover.fewer_makers", { default: "Réduire" })
              : `${t("browse.discover.all_makers", { default: "Tous les fabricants" })} →`}
          </button>
        ) : null}
      </div>

      <div className="cat-bento">
        <button
          type="button"
          className={`cat-bento-tile cat-bento-feat${featTall ? " is-tall" : ""}`}
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
            {figuresLabel(feat.count)}{" "}
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
              {figuresLabel(m.count)}{" "}
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
