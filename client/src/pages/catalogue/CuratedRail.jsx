import { useEffect, useRef } from "react";
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
  const scrollRef = useRef(null);

  // Edge fade — mask whichever side still has off-screen cards so the
  // horizontal cut reads as a soft fade, not a hard slice. Driven imperatively
  // via `data-fade` off scroll/resize (no re-renders); React leaves the
  // attribute alone because the JSX value is static. Re-measures when the
  // figure set changes (content width) or the viewport resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => {
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      el.dataset.fade = atStart && atEnd ? "none" : atStart ? "end" : atEnd ? "start" : "both";
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [figures]);

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
      <ul ref={scrollRef} data-fade="end" className="cat-rail-scroll" role="list">
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
