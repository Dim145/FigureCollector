import { useMemo } from "react";
import { useOwnedItems } from "../../hooks/useCollection.js";
import { useWishlistItems } from "../../hooks/useWishlist.js";
import { useVisualSearchStatus, useSimilarFigures } from "../../hooks/useVisualSearch.js";
import { resolveFigureCover } from "../../lib/coverUrl.js";
import AccentTitle from "../../components/AccentTitle.jsx";
import FigureCard from "../../components/FigureCard.jsx";

/**
 * "Figurines proches" — DINOv2 visual neighbours of this piece, an editorial
 * rail at the foot of the page. Self-hides unless photo search is enabled AND
 * the figure has neighbours on the index (so it never shows an empty shell).
 * The owned/wished seals reuse the cached collection + wishlist queries.
 */
export default function SimilarFiguresSection({ figureId, nsfwPref, t }) {
  const status = useVisualSearchStatus();
  const enabled = !!status.data?.enabled;
  const similar = useSimilarFigures(figureId, { enabled });
  const owned = useOwnedItems();
  const wishlist = useWishlistItems();

  const ownedIds = useMemo(() => new Set((owned.data ?? []).map((o) => o.figure_id)), [owned.data]);
  const wishedIds = useMemo(
    () => new Set((wishlist.data ?? []).map((w) => w.figure_id)),
    [wishlist.data],
  );

  if (!enabled || similar.isPending || similar.isError) return null;
  const figures = similar.data ?? [];
  if (figures.length === 0) return null;

  return (
    <section className="max-w-7xl mx-auto px-6 mt-16">
      <header className="text-center mb-8">
        <p className="micro inline-flex items-center gap-2.5">
          <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
          {t("figure.similar.eyebrow", { default: "Dans le même esprit" })}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            似
          </span>
        </p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-1.5">
          <AccentTitle text={t("figure.similar.title", { default: "Figurines proches" })} />
        </h2>
        <div className="gold-rule w-20 mx-auto mt-4" />
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {figures.map(({ figure: g, distance }) => (
          <FigureCard
            key={g.id}
            figureId={g.id}
            href={`/figures/${g.id}`}
            name={g.name}
            type={g.figure_type}
            manufacturer={g.manufacturer_name ?? null}
            imageUrl={resolveFigureCover(g)}
            scale={g.scale}
            versionName={g.version_name}
            owned={ownedIds.has(g.id)}
            wished={wishedIds.has(g.id)}
            blurImage={g.is_nsfw && nsfwPref === "blur"}
            badge={{ label: `${Math.round((1 - distance) * 100)}%`, tone: "match" }}
          />
        ))}
      </div>
    </section>
  );
}
