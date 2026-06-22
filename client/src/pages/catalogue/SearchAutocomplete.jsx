import { useEffect, useRef } from "react";
import { ArrowUpRight, History, Star, X } from "lucide-react";

/**
 * Autocomplete dropdown anchored under the search input. Three sections:
 *   • Suggestions — facet names (séries / fabricants / personnages / tags)
 *     matching the typed prefix, with the matched prefix bolded + a count.
 *   • Récentes — the localStorage recent searches (shown on focus / empty).
 *   • Populaires — the "popular" proxy (top séries + personnages + tags by
 *     count), derived in the orchestrator from the facets.
 *
 * This renders the listbox only. The combobox keyboard contract (↑/↓ moves the
 * active option, Enter selects it, Escape closes) lives on the search `<input>`
 * in BrowsePage — the input is a SIBLING of this listbox, so events fired while
 * typing never reach a handler here. The active index + key handling are owned
 * by the orchestrator and threaded in as `active` + `onActiveChange`; options
 * are linked by `aria-activedescendant` (each row carries `${listId}-opt-${idx}`)
 * rather than by moving DOM focus, so they stay `tabIndex={-1}` and Tab leaves
 * the field. `idx` is the row's position in the SAME flat order the orchestrator
 * builds (suggestions, then — when the query is empty — recent, then popular).
 */
export default function SearchAutocomplete({
  t,
  open,
  query,
  suggestions,
  recent,
  popular,
  active,
  onActiveChange,
  listId,
  onPick,
  onClearRecent,
  onClose,
}) {
  const rootRef = useRef(null);

  // Close on outside click. (A genuine subscription to an external system, so an
  // effect is the right tool here — no setState in the body.) Escape + Tab-away
  // dismissal live on the input/station in BrowsePage where focus actually is.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  const showRecentPopular = !query && (recent.length > 0 || popular.length > 0);
  const hasRows = suggestions.length > 0 || showRecentPopular;
  if (!open || !hasRows) return null;

  const optId = (idx) => `${listId}-opt-${idx}`;

  return (
    <div ref={rootRef} className="cat-auto">
      <ul
        id={listId}
        role="listbox"
        tabIndex={-1}
        aria-label={t("browse.search.suggestions", { default: "Suggestions" })}
      >
        {suggestions.length > 0 ? (
          <li className="cat-auto-grp" role="presentation">
            <div className="cat-auto-grp-h">
              <span className="ja" aria-hidden>
                候
              </span>
              {t("browse.search.suggestions", { default: "Suggestions" })}
            </div>
            {suggestions.map((s, i) => (
              <Row
                key={`s-${s.kind}-${s.value}`}
                id={optId(i)}
                active={active === i}
                onMouseEnter={() => onActiveChange(i)}
                onClick={() => onPick(s.value, { type: "suggestion", value: s.value, data: s })}
                icon={<ArrowUpRight size={14} aria-hidden />}
              >
                <span className="cat-auto-tx">
                  <Highlighted text={s.value} query={query} />
                  {s.kindLabel ? <span className="cat-auto-kind"> · {s.kindLabel}</span> : null}
                </span>
                {s.count != null ? <span className="cat-auto-meta num">{s.count}</span> : null}
              </Row>
            ))}
          </li>
        ) : null}

        {showRecentPopular ? (
          <li className="cat-auto-grp" role="presentation">
            <div className="cat-auto-grp-h">
              <span className="ja" aria-hidden>
                近
              </span>
              {t("browse.search.recent_popular", { default: "Récentes & populaires" })}
              {recent.length > 0 ? (
                <button
                  type="button"
                  className="cat-auto-clear"
                  onClick={onClearRecent}
                  aria-label={t("browse.search.clear_recent", { default: "Effacer les recherches récentes" })}
                >
                  <X size={11} aria-hidden />
                  {t("browse.search.clear_recent_short", { default: "Effacer" })}
                </button>
              ) : null}
            </div>
            {recent.map((r, i) => {
              const idx = suggestions.length + i;
              return (
                <Row
                  key={`r-${r}`}
                  id={optId(idx)}
                  active={active === idx}
                  onMouseEnter={() => onActiveChange(idx)}
                  onClick={() => onPick(r, { type: "recent", value: r })}
                  icon={<History size={14} aria-hidden />}
                >
                  <span className="cat-auto-tx">{r}</span>
                  <span className="cat-auto-meta">{t("browse.search.recent", { default: "récent" })}</span>
                </Row>
              );
            })}
            {popular.map((p, i) => {
              const idx = suggestions.length + recent.length + i;
              return (
                <Row
                  key={`p-${p.kind}-${p.label}`}
                  id={optId(idx)}
                  active={active === idx}
                  onMouseEnter={() => onActiveChange(idx)}
                  onClick={() => onPick(p.label, { type: "popular", value: p.label, data: p })}
                  icon={<Star size={14} aria-hidden />}
                >
                  <span className="cat-auto-tx">{p.label}</span>
                  <span className="cat-auto-meta">{t("browse.search.popular", { default: "populaire" })}</span>
                </Row>
              );
            })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Row({ id, active, onClick, onMouseEnter, icon, children }) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      className={`cat-auto-row ${active ? "is-active" : ""}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="cat-auto-ic" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Bold the matched prefix of `text` against the typed `query`. */
function Highlighted({ text, query }) {
  const q = (query ?? "").trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const at = lower.indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b>{text.slice(at, at + q.length)}</b>
      {text.slice(at + q.length)}
    </>
  );
}
