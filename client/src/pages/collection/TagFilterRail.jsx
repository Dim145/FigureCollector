import { displayTags } from "../../lib/tags.js";

/**
 * Appearance-tag filter rail for the collection — WD-Tagger tags detected on
 * the user's OWN photos, as selectable chips. Mirrors the catalogue tag-chip
 * styling (Direction-A gold), but toggles a server-side `?tag=` narrowing of
 * the grid rather than linking out to /catalogue.
 *
 * Self-hides when the user has no tagged photos yet (the tagging worker hasn't
 * run, or appearance-tagging is off). Generic tags are dropped via `displayTags`
 * so the rail shows only distinctive looks.
 *
 * On mobile it scrolls horizontally inside its own well (the page never
 * side-scrolls).
 */
export default function TagFilterRail({ t, facets, tagFilter, onSelect }) {
  // `facets` is [{ tag, count }] busiest-first. Drop generic tags using the
  // shared helper (it parses a comma string, so re-join the names for it).
  const rows = Array.isArray(facets) ? facets : [];
  const visible = new Set(displayTags(rows.map((f) => f.tag).join(", "), { max: 40 }));
  const tags = rows.filter((f) => visible.has(f.tag.trim().toLowerCase()));
  if (tags.length === 0) return null;

  return (
    <nav
      aria-label={t("collection.tags.aria", { default: "Filtrer par étiquette" })}
      className="reveal flex flex-wrap gap-2"
      style={{ "--i": 2 }}
    >
      <span className="w-full text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/60 mb-1">
        {t("collection.tags.title", { default: "Étiquettes" })}
      </span>
      {tags.map(({ tag, count }) => {
        const active = tagFilter === tag;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : tag)}
            title={t("collection.tags.filter", { default: "Filtrer par cette étiquette" })}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] capitalize border transition-colors ${
              active
                ? "border-[var(--color-or)] bg-[var(--color-or)]/15 text-[var(--color-or)]"
                : "border-[var(--color-or)]/25 bg-[var(--color-or)]/5 text-[var(--color-ivoire)] hover:border-[var(--color-or)]/60 hover:text-[var(--color-or)]"
            }`}
          >
            <span>{tag}</span>
            <span className="font-mono text-[10px] opacity-60" aria-hidden>
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
