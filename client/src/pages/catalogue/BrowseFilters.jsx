import { X } from "lucide-react";
import TagRail from "../../components/TagRail.jsx";
import { typeHue } from "../../lib/typeHue.js";

/**
 * Catalogue facets: the kanji-tile *type* rail, the active-tag pill, and the
 * popular-tag rail. Rendered inline on desktop and inside a Drawer on mobile
 * (same component, the orchestrator just places it). The kanji rail is the
 * dominant visual; each tile carries its type's signature hue when active.
 *
 * The sort control lives in the PageLayout toolbar, not here — sort is a
 * view-wide concern, these are the in-grid facets.
 *
 * Hidden by the orchestrator in the on-device search modes (a tag/type facet
 * doesn't compose with a semantic ranking).
 */
export default function BrowseFilters({
  t,
  total,
  typeTiles,
  type,
  onSelectType,
  countsByType,
  tag,
  onSelectTag,
  popularTags,
}) {
  return (
    <div>
      <nav aria-label={t("browse.filter_type")} className="tile-rail">
        <FilterTile
          kanji="集"
          romaji={t("browse.filter_all")}
          count={total}
          active={type === ""}
          onClick={() => onSelectType("")}
        />
        {typeTiles.map((tt) => (
          <FilterTile
            key={tt.id}
            typeId={tt.id}
            kanji={tt.kanji}
            romaji={tt.label}
            count={countsByType.get(tt.id) ?? 0}
            active={type === tt.id}
            onClick={() => onSelectType(tt.id)}
          />
        ))}
      </nav>

      {tag ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="micro text-[var(--color-ivoire-soft)]">
            {t("browse.tags.filtered_by", { default: "Filtré par tag" })}
          </span>
          <button
            type="button"
            onClick={() => onSelectTag("")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] capitalize border border-[var(--color-or)]/50 bg-[var(--color-or)]/10 text-[var(--color-or)] hover:border-[var(--color-laque-bright)] hover:text-[var(--color-laque-bright)] transition-colors"
          >
            {tag}
            <X aria-hidden size={13} />
          </button>
        </div>
      ) : null}

      {popularTags.length > 0 ? (
        <div className="mt-5">
          <p className="micro text-[var(--color-ivoire-soft)] mb-2">
            {t("browse.tags.popular", { default: "Tags populaires" })}
          </p>
          <TagRail
            items={popularTags}
            keyOf={(facet) => facet.tag}
            ariaLabel={t("browse.tags.popular", { default: "Tags populaires" })}
            renderChip={(facet) => {
              const active = facet.tag === tag;
              return (
                <button
                  type="button"
                  onClick={() => onSelectTag(active ? "" : facet.tag)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] capitalize border transition-colors ${
                    active
                      ? "border-[var(--color-or)] bg-[var(--color-or)]/15 text-[var(--color-or)]"
                      : "border-[var(--color-or)]/20 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/50 hover:text-[var(--color-or)]"
                  }`}
                >
                  {facet.tag}
                  <span className="font-mono text-[9px] opacity-60">{facet.count}</span>
                </button>
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function FilterTile({ typeId, kanji, romaji, count, active, onClick }) {
  // Each type tile carries its signature hue. At rest the kanji keeps the
  // theme's neutral colour; active, it glows in the type's own colour so the
  // rail reads as a spectrum of categories. Inline styles only (the .tile
  // chrome lives in index.css).
  const hue = typeId ? typeHue(typeId) : "var(--color-or)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tile ${active ? "is-active" : ""}`}
      style={{ "--hue": hue }}
    >
      {count > 0 || active ? (
        <span className="tile-count" aria-hidden>
          {count}
        </span>
      ) : null}
      <span
        className="tile-kanji transition-colors duration-300"
        aria-hidden
        style={active ? { color: "var(--hue)" } : undefined}
      >
        {kanji}
      </span>
      <span className="tile-romaji">{romaji}</span>
    </button>
  );
}
