import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useAniListSearch } from "../hooks/useAniList.js";

/**
 * Inline AniList search. Renders as a collapsible panel; when the user picks
 * a result, calls `onPick({ romaji, native, english, anilistId })`.
 */
export default function AniListLookup({ onPick, initial = "" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initial);
  const [debounced, setDebounced] = useState(initial);

  // Debounce input → query
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const search = useAniListSearch(open ? debounced : "");
  const results = search.data ?? [];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors"
      >
        ↳ {t("addfig.lookup_anilist")}
      </button>
    );
  }

  return (
    <div className="mt-2 border border-[var(--color-or)]/30 bg-[var(--color-noir)]/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addfig.lookup_placeholder")}
          className="flex-1 bg-transparent border-b border-[var(--color-or)]/30 focus:border-[var(--color-or)] outline-none text-sm py-1 text-[var(--color-ivoire)]"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-sm"
          aria-label="close"
        >
          ×
        </button>
      </div>

      {debounced.length < 2 ? (
        <p className="text-xs text-[var(--color-ivoire-soft)] italic">
          {t("addfig.lookup_min")}
        </p>
      ) : search.isLoading ? (
        <p className="text-xs text-[var(--color-ivoire-soft)]">…</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-[var(--color-ivoire-soft)] italic">
          {t("addfig.lookup_no_results")}
        </p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  // The Rust side keeps AniList's field naming on the wire
                  // (type / coverImage / siteUrl), so we read camelCase here.
                  onPick({
                    anilistId: m.id,
                    malId: m.idMal,
                    romaji: m.title?.romaji,
                    english: m.title?.english,
                    native: m.title?.native,
                    coverUrl: m.coverImage?.large ?? m.coverImage?.medium,
                    mediaType: m.type,
                    siteUrl: m.siteUrl,
                    description: m.description,
                  });
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 hover:bg-[var(--color-or)]/10 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="display text-sm text-[var(--color-ivoire)]">
                    {m.title?.romaji ?? m.title?.english ?? m.title?.native ?? "—"}
                  </span>
                  {m.type ? (
                    <span className="micro shrink-0 opacity-70">{m.type}</span>
                  ) : null}
                </div>
                {m.title?.english && m.title.english !== m.title.romaji ? (
                  <p className="text-xs text-[var(--color-ivoire-soft)] mt-0.5">
                    {m.title.english}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
