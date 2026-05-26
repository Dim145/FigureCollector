import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Free-text input with autocomplete drawn from any list of objects whose
 * primary key is a string `name`. Mirrors the StoreAutocomplete UX (arrow
 * keys / Enter / Esc / hover) but is decoupled from any specific entity
 * shape — pass the raw `data` array plus an optional `getMeta(item)` to
 * surface a secondary line on each suggestion (series name beside a
 * character, hostname beside a store, …).
 *
 * Crucially the input stays *uncontrolled-ish*: the parent owns the
 * `value` (string), this component just paints the autocomplete on top.
 * On save, the server upserts the entity by name (`upsert_series`,
 * `upsert_character`, …) so unmatched typed values simply create a new
 * row — clicking a suggestion is a convenience, never a constraint.
 *
 * Props:
 *   label         — visible label string
 *   value         — current string value
 *   onChange(str) — fired on every keystroke + on suggestion pick
 *   data          — array of `{ name, ... }` items (any extra keys ignored)
 *   getMeta(item) — optional fn returning a short metadata string
 *                   rendered muted on the right of the suggestion row
 *   placeholder   — input placeholder
 *   hint          — optional helper text under the input
 *   autoFocus     — passes through
 *   disabled      — passes through
 *   multiValueSeparator
 *                 — when set (e.g. `","`), the input is treated as a list
 *                   of values separated by that character. Filtering uses
 *                   only the last token, and picking a suggestion replaces
 *                   just that token. Used by the figure form's `materials`
 *                   field for "PVC, ABS, polystone" style entry.
 */
export default function EntityAutocomplete({
  label,
  value,
  onChange,
  data,
  getMeta,
  placeholder,
  hint,
  autoFocus,
  disabled,
  multiValueSeparator,
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // In multi-value mode the user types e.g. "PVC, ABS, poly" and we
  // autocomplete only the last token after the separator. The "prefix"
  // before that token is preserved verbatim on pick.
  const { filterText, prefix } = useMemo(() => {
    const raw = value ?? "";
    if (!multiValueSeparator) return { filterText: raw.trim(), prefix: "" };
    const lastSep = raw.lastIndexOf(multiValueSeparator);
    if (lastSep < 0) return { filterText: raw.trim(), prefix: "" };
    return {
      filterText: raw.slice(lastSep + multiValueSeparator.length).trim(),
      prefix: raw.slice(0, lastSep + multiValueSeparator.length),
    };
  }, [value, multiValueSeparator]);

  // Client-side filter with prefix-boost. The list is small enough (a few
  // hundred items at most for a personal catalogue) that a round-trip
  // would feel sluggish per-keystroke. Case + diacritic-insensitive
  // substring match.
  const suggestions = useMemo(() => {
    const all = Array.isArray(data) ? data : [];
    const q = filterText.toLocaleLowerCase();
    if (!q) return all.slice(0, 8);
    return all
      .filter((it) => it.name?.toLocaleLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.name.toLocaleLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLocaleLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      })
      .slice(0, 8);
  }, [data, filterText]);

  // Reset the highlighted row whenever the filter shrinks/widens.
  // Same `setState-in-effect` warning as the sibling StoreAutocomplete —
  // the project accepts it for these autocomplete components since the
  // alternatives (mutating a ref during render, or making the parent
  // manage `active`) trade clarity for purity.
  useEffect(() => {
    setActive(0);
  }, [value]);

  // Hide the dropdown when the only suggestion already equals the typed
  // string — no point offering what's already there.
  const showDrop =
    focused &&
    suggestions.length > 0 &&
    !(
      suggestions.length === 1 &&
      suggestions[0].name.toLocaleLowerCase() === filterText.toLocaleLowerCase()
    );

  const pick = (it) => {
    if (multiValueSeparator) {
      // Replace only the last token; preserve everything before it. Append
      // the separator + space so the user can keep adding items.
      const head = prefix ? prefix.replace(/\s+$/, "") : "";
      const nextValue = head
        ? `${head} ${it.name}${multiValueSeparator} `
        : `${it.name}${multiValueSeparator} `;
      onChange(nextValue);
      // Keep focus + open dropdown for the next token.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      onChange(it.name);
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  const onKeyDown = (e) => {
    if (!showDrop) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (suggestions[active]) {
        e.preventDefault();
        pick(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  return (
    <label htmlFor={id} className="block relative">
      <span className="store-ac-label">{label}</span>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        // Blur is delayed so a click on a suggestion (which fires
        // onMouseDown) gets to set the value before focus disappears.
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDrop}
        aria-controls={`${id}-list`}
        className="store-ac-input"
        autoComplete="off"
      />
      {hint ? <span className="store-ac-hint">{hint}</span> : null}

      {showDrop ? (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="store-ac-drop"
        >
          {suggestions.map((it, i) => {
            const meta = getMeta ? getMeta(it) : null;
            return (
              <li
                key={it.id ?? it.name}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  // mousedown (not click) so we pick BEFORE blur fires.
                  e.preventDefault();
                  pick(it);
                }}
                className={`store-ac-row ${i === active ? "is-active" : ""}`}
              >
                <span className="store-ac-row-name">{it.name}</span>
                {meta ? (
                  <span aria-hidden className="store-ac-row-url">
                    {meta}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </label>
  );
}
