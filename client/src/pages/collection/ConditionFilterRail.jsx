/**
 * Condition filter rail — kanji-faced tiles, one per condition present in the
 * collection, plus the "annulées" (cancelled-and-kept) facet folded in as a
 * real tile rather than the old buried show/hide link.
 *
 * On mobile the rail scrolls horizontally inside its own well (the page never
 * side-scrolls). Each tile is a ≥44px hit target.
 */

const CONDITION_FILTERS = ["all", "mib_sealed", "opened_box", "displayed", "loose", "damaged"];

/** One kanji per condition, picked for resonance: 全 (all), 封 (sealed),
 *  開 (opened), 飾 (displayed), 裸 (loose / bare), 痍 (damaged), 廃 (cancelled). */
const CONDITION_KANJI = {
  all: "全",
  mib_sealed: "封",
  opened_box: "開",
  displayed: "飾",
  loose: "裸",
  damaged: "痍",
};

export default function ConditionFilterRail({
  t,
  conditionFilter,
  onSelect,
  countsByCondition,
  totalCount,
  // Archived ("annulées") facet, folded in as a tile.
  showArchived,
  onToggleArchived,
  archivedCount,
}) {
  return (
    <nav
      aria-label={t("collection.filter.aria", { default: "Filtrer par état" })}
      className="tile-rail reveal"
      style={{ "--i": 1 }}
    >
      {CONDITION_FILTERS.map((c) => {
        const active = conditionFilter === c;
        const count = c === "all" ? totalCount : (countsByCondition.get(c) ?? 0);
        if (c !== "all" && count === 0) return null;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(c)}
            className={`tile ${active ? "is-active" : ""}`}
          >
            <span className="tile-count" aria-hidden>
              {count}
            </span>
            <span className="tile-kanji" aria-hidden>
              {CONDITION_KANJI[c] ?? "・"}
            </span>
            <span className="tile-romaji">
              {c === "all" ? t("collection.filter.all") : t(`condition.${c}`)}
            </span>
          </button>
        );
      })}

      {/* "Annulées" facet — only offered once there's at least one to surface
          (or while it's already engaged). Hanko-red faced, since a cancellation
          is a loss state. Promotes the old inline show/hide link to a peer of
          the condition tiles. */}
      {archivedCount > 0 || showArchived ? (
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={onToggleArchived}
          className={`tile ${showArchived ? "is-active" : ""}`}
          style={showArchived ? { "--hue": "var(--color-laque-bright)" } : undefined}
        >
          <span className="tile-count" aria-hidden>
            {archivedCount}
          </span>
          <span className="tile-kanji" aria-hidden>
            廃
          </span>
          <span className="tile-romaji">
            {t("collection.filter.cancelled", { default: "Annulées" })}
          </span>
        </button>
      ) : null}
    </nav>
  );
}

export { CONDITION_FILTERS, CONDITION_KANJI };
