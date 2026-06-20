import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import AccentTitle from "../../components/AccentTitle.jsx";
import FigureCard from "../../components/FigureCard.jsx";
import { resolveFigureCover } from "../../lib/coverUrl.js";
import { useVisualSearchStatus, useRecommendations } from "../../hooks/useVisualSearch.js";

/**
 * "Recommandé pour toi" — catalogue figures whose look is nearest to what the
 * user owns (DINOv2 reco, already gated to ≥ the admin similarity threshold &
 * excluding owned/wishlisted server-side). Shows 4 at a time out of a deeper
 * pool; each can be "skipped" to reveal the next. When the whole pool is
 * skipped (or there's nothing to suggest) the shelf retires with a small
 * collapse. NSFW: server excludes for hide-viewers, we blur for blur.
 *
 * Self-hides entirely when photo search is off, the reco is loading/erroring,
 * or the pool is empty — so the page never shows a dead header.
 */
export default function RecommendedShelf({ t, nsfwPref }) {
  const status = useVisualSearchStatus();
  const enabled = !!status.data?.enabled;
  const reco = useRecommendations({ enabled });
  const reduce = useReducedMotion();
  const [dismissed, setDismissed] = useState(() => new Set());

  const pool = reco.data ?? [];
  const visible = pool.filter((p) => !dismissed.has(p.figure.id)).slice(0, 4);
  // Every recommendation skipped → retire the shelf (with a collapse).
  const exhausted = pool.length > 0 && visible.length === 0;

  if (!enabled || reco.isPending || reco.isError) return null;
  if (pool.length === 0) return null;

  const skip = (id) => setDismissed((prev) => new Set(prev).add(id));

  return (
    <AnimatePresence>
      {!exhausted && (
        <motion.section
          key="reco"
          className="mt-16"
          exit={
            reduce
              ? {}
              : {
                  opacity: 0,
                  y: -12,
                  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
                }
          }
        >
          <header className="text-center mb-8">
            <p className="micro inline-flex items-center gap-2.5">
              <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
              {t("collection.reco.eyebrow")}
              <span aria-hidden className="ja not-italic text-[var(--color-or)]">
                薦
              </span>
            </p>
            <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-1.5">
              <AccentTitle text={t("collection.reco.title")} />
            </h2>
            <div className="gold-rule w-20 mx-auto mt-4" />
          </header>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map(({ figure: g, distance }) => (
                <motion.li
                  key={g.id}
                  layout
                  initial={reduce ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={
                    reduce
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.9, transition: { duration: 0.28 } }
                  }
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <FigureCard
                    figureId={g.id}
                    href={`/figures/${g.id}`}
                    name={g.name}
                    type={g.figure_type}
                    manufacturer={g.manufacturer_name ?? null}
                    imageUrl={resolveFigureCover(g)}
                    scale={g.scale}
                    versionName={g.version_name}
                    blurImage={g.is_nsfw && nsfwPref === "blur"}
                    badge={{ label: `${Math.round((1 - distance) * 100)}%`, tone: "match" }}
                  />
                  <button
                    type="button"
                    onClick={() => skip(g.id)}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2 border border-[var(--color-or)]/35 bg-[var(--color-noir)]/50 text-[11px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)]/60 hover:bg-[var(--color-laque)]/10 transition-colors"
                  >
                    <span aria-hidden className="text-[var(--color-or)]">
                      ✕
                    </span>
                    {t("collection.reco.skip")}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
