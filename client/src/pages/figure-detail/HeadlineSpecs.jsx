import { Link } from "react-router-dom";

/**
 * Headline specs rail — fabricant / série / personnage / échelle. Extracted
 * from the old FigureHeroPanel so #identite can render the four "Coup d'œil"
 * rows. The cartouche deliberately skips these four so nothing duplicates.
 *
 * A thin filets rail: a hairline per row, a mono-caps label over a
 * display-serif value — an editorial spec list rather than a boxed grid.
 */
export default function HeadlineSpecs({ f, t }) {
  const rows = [
    {
      label: t("figure.spec.manufacturer"),
      value: f.manufacturer_name,
      href: f.manufacturer_slug ? `/catalogue/manufacturers/${f.manufacturer_slug}` : null,
    },
    {
      label: t("figure.spec.series"),
      value: f.series_name,
      href: f.series_slug ? `/catalogue/series/${f.series_slug}` : null,
    },
    {
      label: t("figure.spec.character"),
      value: f.character_name,
      href: f.character_slug ? `/catalogue/characters/${f.character_slug}` : null,
    },
    {
      label: t("figure.spec.scale"),
      value: f.scale,
    },
  ].filter((r) => !!r.value);
  if (rows.length === 0) return null;
  return (
    <dl className="fig-specrail">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>
            {r.href ? (
              <Link
                to={r.href}
                className="hover:text-[var(--color-or-pale)] transition-colors underline decoration-[var(--color-or)]/30 underline-offset-4 hover:decoration-[var(--color-or)]"
              >
                {r.value}
              </Link>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
