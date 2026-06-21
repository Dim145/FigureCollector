import DescriptionBlock from "./Description.jsx";
import HeadlineSpecs from "./HeadlineSpecs.jsx";

/**
 * #identite — the catalog identity section of ⓪ La Fiche.
 *
 *   left  — the editorial drop-cap lede (DescriptionBlock), when a description
 *           exists.
 *   right — a "Coup d'œil" key-specs summary (HeadlineSpecs: fabricant / série /
 *           personnage / échelle) + the Production group (作: sculptor /
 *           materials / release / height / edition / exclusivity) as a grouped
 *           single-column <dl>.
 *
 * Both DescriptionBlock and HeadlineSpecs were extracted from the old
 * FigureHeroPanel; the Production rows are the cartouche's `作` block re-placed
 * here (nothing duplicates — the cartouche no longer renders Production).
 */
export default function IdentitySection({ f, t }) {
  const productionRows = [
    { label: t("figure.spec.sculptor"), value: f.sculptor_name },
    {
      label: t("figure.spec.materials"),
      value: f.materials?.length ? f.materials.join(" · ") : null,
    },
    { label: t("figure.spec.release"), value: f.release_date },
    { label: t("figure.spec.height"), value: f.height_mm ? `${f.height_mm} mm` : null },
    { label: t("figure.spec.edition"), value: f.edition },
    { label: t("figure.spec.exclusivity"), value: f.exclusivity },
  ].filter((r) => !!r.value);

  return (
    <div className="fig-id-grid">
      {f.description ? (
        <div className="min-w-0">
          <DescriptionBlock text={f.description} t={t} />
        </div>
      ) : (
        <div className="min-w-0" />
      )}

      <div className="min-w-0">
        <div className="fig-keyspecs">
          <div className="fig-keyspecs-label">
            {t("figure.identity.glance", { default: "Coup d'œil" })}
          </div>
          <HeadlineSpecs f={f} t={t} />
        </div>

        {productionRows.length > 0 ? (
          <div className="fig-specs-group">
            <div className="fig-specs-group-title">
              <span className="ja" aria-hidden>
                作
              </span>
              {t("figure.cartouche.production")}
            </div>
            <dl className="fig-specs">
              {productionRows.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
