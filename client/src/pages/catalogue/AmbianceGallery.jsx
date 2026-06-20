import Reveal from "../../components/motion/Reveal.jsx";
import { SectionSkeleton } from "../../components/Skeleton.jsx";
import { resolveFigureCover } from "../../lib/coverUrl.js";
import { EmptyResults } from "./CatalogueResults.jsx";

/**
 * "Browse par ambiance" — a gallery of DINOv2 visual-style clusters. Each tile
 * is a 2×2 mosaic of representative covers + the dominant type's kanji + a
 * count. Owns its loading / error / empty states.
 */
export default function AmbianceGallery({ query, typeMeta, onOpen, me, t }) {
  if (query.isPending) return <SectionSkeleton />;
  if (query.isError) return <EmptyResults t={t} />;
  // Drop singletons — a 1-figure "vibe" (a visual outlier k-means parked on its
  // own) isn't browseable; it still shows in the flat catalogue.
  const clusters = (query.data ?? []).filter((c) => c.count >= 2);
  if (clusters.length === 0) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">
        {t("browse.ambiance.empty", {
          default: "Pas encore assez d'images indexées pour dégager des ambiances.",
        })}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {clusters.map((c, i) => (
        <Reveal as="li" key={c.id} delay={Math.min(i, 6) * 0.06} y={24}>
          <AmbianceTile cluster={c} typeMeta={typeMeta} onOpen={onOpen} me={me} t={t} />
        </Reveal>
      ))}
    </ul>
  );
}

function AmbianceTile({ cluster, typeMeta, onOpen, me, t }) {
  const meta = typeMeta.get(cluster.dominant_type);
  const reps = cluster.representatives ?? [];
  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";
  return (
    <button
      type="button"
      onClick={() => onOpen(cluster)}
      className="group block w-full text-left border border-[var(--color-or)]/20 bg-[var(--color-noir)]/40 hover:border-[var(--color-or)]/50 transition-colors overflow-hidden"
    >
      <div className="grid grid-cols-2 gap-px bg-[var(--color-or)]/10 aspect-[4/3]">
        {Array.from({ length: 4 }).map((_, idx) => {
          const f = reps[idx];
          return (
            <div key={idx} className="relative overflow-hidden bg-[var(--color-noir)]">
              {f ? (
                <img
                  src={resolveFigureCover(f)}
                  alt=""
                  loading="lazy"
                  className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${
                    f.is_nsfw && nsfwPref === "blur" ? "nsfw-blur" : ""
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-lg shrink-0">
            {meta?.kanji ?? "彩"}
          </span>
          <span
            className="truncate capitalize text-[var(--color-ivoire)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {cluster.name ||
              `${t("browse.ambiance.untitled", { default: "Ambiance" })} ${cluster.id + 1}`}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--color-ivoire-soft)]">
          {cluster.count}
        </span>
      </div>
    </button>
  );
}

/** Drill-in header for an opened ambiance, wrapping its figure grid. */
export function AmbianceDrillIn({ cluster, typeMeta, onBack, t, children }) {
  const meta = typeMeta.get(cluster.dominant_type);
  return (
    <div>
      <div className="flex items-center flex-wrap gap-x-3 gap-y-2 mb-6 reveal">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
        >
          <span aria-hidden>←</span>
          {t("browse.ambiance.back", { default: "Ambiances" })}
        </button>
        <span aria-hidden className="text-[var(--color-or)]/30">
          ·
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-lg">
            {meta?.kanji ?? "彩"}
          </span>
          <span
            className="capitalize text-[var(--color-ivoire)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {cluster.name ||
              `${t("browse.ambiance.untitled", { default: "Ambiance" })} ${cluster.id + 1}`}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-ivoire-soft)]">
            {cluster.count}
          </span>
        </span>
      </div>
      {children}
    </div>
  );
}
