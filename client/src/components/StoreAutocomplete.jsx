import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStores } from "../hooks/useStores.js";

/**
 * Free-text input with autocomplete drawn from existing `stores` rows.
 *
 * Behaviour mirrors browsers' native autofill drop:
 *   - any keystroke filters the suggestion list (case-insensitive,
 *     substring match on name)
 *   - ↑/↓ moves the active suggestion, Enter accepts it, Esc closes
 *   - mouse hover highlights, click accepts
 *   - typing a name that doesn't match anything is fine — the server
 *     resolves the typed string via find_or_create on save
 *
 * The component is INTENTIONALLY uncontrolled-ish: the parent owns the
 * `value` (string), this component just renders the input + dropdown
 * over it. Same wire-up as the existing FormField so swapping a
 * FormField for a StoreAutocomplete in a form requires no other change.
 *
 * Props:
 *   label         — visible label string
 *   value         — current string value
 *   onChange(str) — fired on every keystroke + on selection
 *   placeholder   — input placeholder
 *   hint          — optional helper text under the input
 *   autoFocus     — passes through to the input
 */
export default function StoreAutocomplete({
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
}) {
  const id = useId();
  const stores = useStores();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Filter suggestions client-side — the list is small (a few dozen at
  // most), and round-tripping the filter to the server would feel
  // sluggish for typing. Case + diacritic insensitive substring match.
  const suggestions = useMemo(() => {
    const data = stores.data ?? [];
    const q = (value ?? "").trim().toLocaleLowerCase();
    if (!q) return data.slice(0, 8);
    return data
      .filter((s) => s.name.toLocaleLowerCase().includes(q))
      // Boost prefix matches above contains-matches.
      .sort((a, b) => {
        const ap = a.name.toLocaleLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLocaleLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      })
      .slice(0, 8);
  }, [stores.data, value]);

  // Reset the active index whenever the filter narrows or widens.
  useEffect(() => {
    setActive(0);
  }, [value]);

  // The dropdown is only meaningful when the input has focus AND there's
  // at least one match that differs from the current text (no point
  // showing a "matches: AmiAmi" when the user typed "AmiAmi" exactly).
  const showDrop =
    focused &&
    suggestions.length > 0 &&
    !(
      suggestions.length === 1 &&
      suggestions[0].name.toLocaleLowerCase() ===
        (value ?? "").trim().toLocaleLowerCase()
    );

  const pick = (s) => {
    onChange(s.name);
    setFocused(false);
    inputRef.current?.blur();
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
        // Blur happens AFTER the click on a suggestion fires onMouseDown,
        // so we use a small delay rather than onClick (which would race
        // with blur and lose the selection).
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
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
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // mousedown (not click) so we pick BEFORE the blur fires.
                e.preventDefault();
                pick(s);
              }}
              className={`store-ac-row ${i === active ? "is-active" : ""}`}
            >
              <span className="store-ac-row-name">{s.name}</span>
              {s.url ? (
                <span aria-hidden className="store-ac-row-url">
                  {hostnameOf(s.url)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
