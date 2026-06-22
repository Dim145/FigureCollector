import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * The left facet rail (FACETTES mode). Three quick toggles (Possédées /
 * Souhaits / NSFW) over collapsible Fabricant / Série / Personnage / Échelle /
 * Tags groups, each value carrying its catalogue count (tabular-nums).
 *
 * Filtering split (see BrowsePage):
 *   • Manufacturer → drives the figures query server-side (the list endpoint
 *     accepts a `manufacturer` name/slug match), single-select.
 *   • Série / Personnage / Échelle / Tags / Possédées / Souhaits → client-side
 *     over the loaded figures (multi-select sets).
 *
 * Selection state is owned by the orchestrator and passed as `filters` +
 * mutators; this component is declarative. Same markup is reused inside the
 * mobile Drawer.
 */
export default function FacetRail({ t, facets, counts, filters, actions }) {
  const f = facets ?? {};
  const moreLabel = (n) => t("browse.facets.more", { default: "+ {n} de plus", n });
  const lessLabel = t("browse.facets.less", { default: "Réduire" });
  return (
    <div className="cat-facets">
      <div className="cat-quick">
        <QuickToggle
          kanji="私"
          label={t("browse.facets.owned", { default: "Possédées" })}
          count={counts?.owned}
          on={filters.owned}
          onToggle={actions.toggleOwned}
        />
        <QuickToggle
          kanji="願"
          label={t("browse.facets.wished", { default: "Souhaits" })}
          count={counts?.wished}
          on={filters.wished}
          onToggle={actions.toggleWished}
        />
        <QuickToggle
          kanji="隠"
          label={t("browse.facets.nsfw", { default: "Afficher NSFW" })}
          on={filters.nsfw}
          onToggle={actions.toggleNsfw}
          danger
        />
      </div>

      <FacetGroup
        kanji="社"
        title={t("figure.spec.manufacturer", { default: "Fabricant" })}
        items={f.manufacturers}
        keyOf={(m) => m.name}
        labelOf={(m) => m.name}
        isOn={(m) => filters.manufacturer === m.name}
        onToggle={(m) => actions.pickManufacturer(filters.manufacturer === m.name ? "" : m.name)}
        defaultOpen
        moreLabel={moreLabel}
        lessLabel={lessLabel}
      />
      <FacetGroup
        kanji="作"
        title={t("browse.facets.series", { default: "Série" })}
        items={f.series}
        keyOf={(s) => s.name}
        labelOf={(s) => s.name}
        isOn={(s) => filters.series.has(s.name)}
        onToggle={(s) => actions.toggleSet("series", s.name)}
        defaultOpen
        moreLabel={moreLabel}
        lessLabel={lessLabel}
      />
      <FacetGroup
        kanji="人"
        title={t("browse.facets.character", { default: "Personnage" })}
        items={f.characters}
        keyOf={(c) => c.name}
        labelOf={(c) => c.name}
        isOn={(c) => filters.characters.has(c.name)}
        onToggle={(c) => actions.toggleSet("characters", c.name)}
        moreLabel={moreLabel}
        lessLabel={lessLabel}
      />
      <FacetGroup
        kanji="寸"
        title={t("browse.facets.scale", { default: "Échelle" })}
        items={f.scales}
        keyOf={(s) => s.value}
        labelOf={(s) => s.value}
        isOn={(s) => filters.scales.has(s.value)}
        onToggle={(s) => actions.toggleSet("scales", s.value)}
        moreLabel={moreLabel}
        lessLabel={lessLabel}
      />

      {f.tags && f.tags.length > 0 ? (
        <details className="cat-facet-grp">
          <summary className="cat-facet-summary">
            <span className="ja" aria-hidden>
              札
            </span>
            {t("browse.facets.tags", { default: "Tags populaires" })}
            <ChevronDown className="cat-facet-chev" size={14} aria-hidden />
          </summary>
          <div className="cat-facet-tags">
            {f.tags.map((tg) => {
              const on = filters.tags.has(tg.tag);
              return (
                <button
                  key={tg.tag}
                  type="button"
                  className={`cat-fchip ${on ? "is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => actions.toggleSet("tags", tg.tag)}
                >
                  {tg.tag}
                  <span className="cat-ct num">{tg.count}</span>
                </button>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function QuickToggle({ kanji, label, count, on, onToggle, danger }) {
  return (
    <button
      type="button"
      className={`cat-toggle ${on ? "is-on" : ""} ${danger ? "cat-toggle-nsfw" : ""}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      <span className="cat-sw" aria-hidden />
      <span className="cat-toggle-lbl">
        <span className="ja" aria-hidden>
          {kanji}
        </span>
        {label}
      </span>
      {count != null ? <span className="cat-ct num">{count}</span> : null}
    </button>
  );
}

const VISIBLE_CAP = 6;

function FacetGroup({
  kanji,
  title,
  items,
  keyOf,
  labelOf,
  isOn,
  onToggle,
  defaultOpen,
  moreLabel,
  lessLabel,
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = items ?? [];
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, VISIBLE_CAP);
  const hidden = rows.length - shown.length;
  return (
    <details className="cat-facet-grp" open={defaultOpen}>
      <summary className="cat-facet-summary">
        <span className="ja" aria-hidden>
          {kanji}
        </span>
        {title}
        <ChevronDown className="cat-facet-chev" size={14} aria-hidden />
      </summary>
      <div className="cat-facet-opts">
        {shown.map((it) => {
          const on = isOn(it);
          return (
            <label key={keyOf(it)} className={`cat-facet-opt ${on ? "is-on" : ""}`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onToggle(it)}
              />
              <span className="cat-box" aria-hidden>
                <Check size={10} strokeWidth={3} />
              </span>
              <span className="cat-facet-nm">{labelOf(it)}</span>
              <span className="cat-ct num">{it.count}</span>
            </label>
          );
        })}
        {hidden > 0 ? (
          <button type="button" className="cat-facet-more" onClick={() => setExpanded(true)}>
            {moreLabel(hidden)}
          </button>
        ) : expanded && rows.length > VISIBLE_CAP ? (
          <button type="button" className="cat-facet-more" onClick={() => setExpanded(false)}>
            {lessLabel}
          </button>
        ) : null}
      </div>
    </details>
  );
}
