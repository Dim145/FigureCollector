import FigureCard from "../../components/FigureCard.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { EmptyState } from "../../components/ui/index.js";
import { SectionSkeleton } from "../../components/Skeleton.jsx";
import { resolveFigureCoverSources } from "../../lib/coverUrl.js";
import { preorderBadgeLabel, preorderPhaseFromFigure } from "../../lib/preorderStatus.js";

/**
 * The catalogue's figure grid — the default keyword view, and the shared body
 * for the ambiance drill-in and the semantic / look result panes. Staggered
 * reveal + the standard owned / wished / preorder card chrome.
 *
 * When `scores` (id → display "% match") is supplied, each card stamps a match
 * badge instead of its preorder badge — that's how semantic / look results read
 * like the discovery rails.
 */
export function FigureGrid({ figures, scores, ownedIds, wishedIds, me, t }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {figures.map((f, i) => {
        const cover = resolveFigureCoverSources(f);
        return (
        <Reveal as="li" key={f.id} delay={Math.min(i, 7) * 0.05} y={24}>
          <FigureCard
            figureId={f.id}
            href={`/figures/${f.id}`}
            name={f.name}
            type={f.figure_type}
            manufacturer={f.manufacturer_name ?? null}
            imageUrl={cover.primary}
            imageFallback={cover.fallback}
            scale={f.scale}
            versionName={f.version_name}
            owned={ownedIds.has(f.id)}
            wished={wishedIds.has(f.id)}
            blurImage={f.is_nsfw && (me.data?.user?.nsfw_visibility ?? "hide") !== "show"}
            badge={(() => {
              // Semantic / look modes: a "% match" stamp (the scores map already
              // holds the display percent). Otherwise the preorder badge.
              const pct = scores?.get(f.id);
              if (pct != null) {
                return { label: `${pct}%`, tone: "match" };
              }
              const phase = preorderPhaseFromFigure(f);
              const label = preorderBadgeLabel(phase, t);
              return label ? { label, tone: phase === "imminent" ? "imminent" : "preorder" } : null;
            })()}
          />
        </Reveal>
        );
      })}
    </ul>
  );
}

/** Zero-results block, shared by every view. Composes the foundation EmptyState
 *  (faint kanji watermark + eyebrow + display title). */
export function EmptyResults({ t }) {
  return <EmptyState kanji="無" eyebrow={t("browse.empty_eyebrow")} title={t("browse.empty")} />;
}

/**
 * The default catalogue view: keyword-filtered, client-sorted grid. Owns its
 * own loading / empty states so the orchestrator just hands it the data.
 */
export default function CatalogueResults({ figures, loading, ownedIds, wishedIds, me, t }) {
  if (loading) return <SectionSkeleton />;
  if (figures.length === 0) return <EmptyResults t={t} />;
  return <FigureGrid figures={figures} ownedIds={ownedIds} wishedIds={wishedIds} me={me} t={t} />;
}
