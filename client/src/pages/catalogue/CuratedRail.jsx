import FigureCard from "../../components/FigureCard.jsx";
import { resolveFigureCover } from "../../lib/coverUrl.js";
import { preorderBadgeLabel, preorderPhaseFromFigure } from "../../lib/preorderStatus.js";

/**
 * A horizontal discovery rail: editorial head (kanji + accent title + gold
 * filet) over a horizontal-scroll strip of FigureCards. Used three times in the
 * discovery front door (Récemment ajoutées / Pré-commandes à venir / De tes
 * studios favoris). Hidden by the caller when `figures` is empty.
 *
 * Cards reuse the catalogue FigureCard verbatim so they read identically to the
 * grid; the rail just sizes each one to a fixed width and lets the row scroll.
 */
export default function CuratedRail({
  kanji,
  title,
  accent,
  vertical,
  note,
  figures,
  ownedIds,
  wishedIds,
  me,
  t,
}) {
  if (!figures || figures.length === 0) return null;
  const nsfwPref = me?.data?.user?.nsfw_visibility ?? "hide";
  return (
    <section className="cat-rail-block">
      <header className="cat-rail-head">
        <span className="ja cat-rail-kanji" aria-hidden>
          {kanji}
        </span>
        <h3 className="cat-rail-title display">
          {accent ? <span className="cat-em">{accent} </span> : null}
          {title}
          {note ? <span className="cat-rail-note"> {note}</span> : null}
        </h3>
        <span className="cat-rail-filet" aria-hidden />
        {vertical ? (
          <span className="ja cat-rail-vtxt" aria-hidden>
            {vertical}
          </span>
        ) : null}
      </header>
      <ul className="cat-rail-scroll" role="list">
        {figures.map((f) => {
          const phase = preorderPhaseFromFigure(f);
          const label = preorderBadgeLabel(phase, t);
          return (
            <li key={f.id} className="cat-rail-item">
              <FigureCard
                figureId={f.id}
                href={`/figures/${f.id}`}
                name={f.name}
                type={f.figure_type}
                manufacturer={f.manufacturer_name ?? null}
                imageUrl={resolveFigureCover(f)}
                scale={f.scale}
                versionName={f.version_name}
                owned={ownedIds.has(f.id)}
                wished={wishedIds.has(f.id)}
                blurImage={f.is_nsfw && nsfwPref !== "show"}
                badge={
                  label ? { label, tone: phase === "imminent" ? "imminent" : "preorder" } : null
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
