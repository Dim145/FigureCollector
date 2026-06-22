import { useRef } from "react";
import { Search, Camera, ScanBarcode, Info } from "lucide-react";
import { SegmentedControl, IconButton } from "../../components/ui/index.js";

/**
 * The catalogue's single search station — the page's primary affordance. One
 * toolbar, top to bottom:
 *
 *   1. mode SegmentedControl (Mots-clés · Description · Apparence) + a "?" Info
 *      IconButton that opens the help modal — only shown when AI search is on;
 *   2. the big search field, its placeholder following the active mode;
 *   3. inline actions inside the field: photo search (gold camera) + barcode
 *      scan (jade), the camera gated on the photo-search feature flag.
 *
 * All state lives in BrowsePage; this is declarative. The mode control unifies
 * what used to be two competing toggles, and the help is reachable from a real
 * IconButton instead of a bare glyph.
 */
export default function SearchBar({
  t,
  query,
  onQueryChange,
  onFocus,
  onKeyDown,
  searchModes,
  mode,
  onModeChange,
  isSemantic,
  isLook,
  photoEnabled,
  onPhoto,
  onScan,
  onOpenHelp,
  // Combobox wiring (keyword mode only — set by BrowsePage). When `listId` is
  // present the input announces itself as a combobox driving that listbox, with
  // the active option reflected via aria-activedescendant.
  listId,
  comboExpanded,
  activeId,
}) {
  const photoInputRef = useRef(null);
  const showModes = searchModes.length > 1;
  const combo = !!listId;

  const placeholder = isSemantic
    ? t("browse.search.semantic_placeholder", {
        default: "Par description — ex. mariée, statue en résine, Re:Zero…",
      })
    : isLook
      ? t("browse.search.look_placeholder", {
          default: "Par l'apparence — ex. fille aux cheveux blancs, robot mécha…",
        })
      : t("browse.search_placeholder");

  return (
    <div>
      {showModes ? (
        <div className="mb-3 flex items-center gap-2 overflow-x-auto -mx-1 px-1">
          <SegmentedControl
            aria-label={t("browse.search.mode_aria", {
              default: "Mode de recherche",
            })}
            options={searchModes}
            value={mode}
            onChange={onModeChange}
            className="shrink-0"
          />
          <IconButton
            icon={Info}
            size="sm"
            label={t("browse.search.help_aria", {
              default: "À quoi servent ces modes ?",
            })}
            onClick={onOpenHelp}
            className="shrink-0"
          />
        </div>
      ) : null}

      <div className="relative">
        <Search
          aria-hidden
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-or)] pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          {...(combo
            ? {
                role: "combobox",
                "aria-expanded": !!comboExpanded,
                "aria-controls": listId,
                "aria-autocomplete": "list",
                "aria-activedescendant": activeId || undefined,
              }
            : {})}
          className={`w-full pl-12 ${
            photoEnabled ? "pr-[6.5rem]" : "pr-14"
          } py-4 bg-[var(--color-noir)] border border-[var(--color-or)]/25 text-[var(--color-ivoire)] placeholder:text-[var(--color-ivoire-soft)]/40 text-lg outline-none focus:border-[var(--color-or)] transition-colors`}
          style={{
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.005em",
          }}
        />
        {/* Inline field actions: photo search (gold camera) + barcode scan (jade). */}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {photoEnabled ? (
            <>
              {/* No `capture` attr → native camera/gallery chooser, same as /recognize. */}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  onPhoto(e.target.files?.[0]);
                  // Allow re-picking the same file (onChange won't fire twice otherwise).
                  e.target.value = "";
                }}
              />
              <IconButton
                icon={Camera}
                label={t("recognize.title")}
                onClick={() => photoInputRef.current?.click()}
                className="!text-[var(--color-or)] hover:!text-[var(--color-laque-bright)]"
              />
            </>
          ) : null}
          <IconButton
            icon={ScanBarcode}
            label={t("scan.title")}
            onClick={onScan}
            className="!text-[var(--color-jade)] hover:!text-[var(--color-or)]"
          />
        </div>
      </div>
    </div>
  );
}
