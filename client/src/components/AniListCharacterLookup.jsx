import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { api } from "../lib/api.js";
import { useAniListCharacterSearch } from "../hooks/useAniList.js";

/**
 * Inline AniList character search — sibling of `AniListLookup` (series).
 *
 * When `mediaId` is set (the figure form passes the picked series' AniList
 * id) the search is scoped to that series' character roster, so an empty
 * query already lists its characters and typing filters them. Without a
 * series, it's a free character search across AniList.
 *
 * On pick we fetch the full character (`/external/anilist/character/{id}`,
 * cached server-side) to enrich the description + site URL, then hand the
 * caller `{ anilistId, full, native, portraitUrl, description, siteUrl }`.
 */
export default function AniListCharacterLookup({ onPick, mediaId = null, seriesLabel = "" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const scoped = mediaId != null && mediaId !== "";
  const search = useAniListCharacterSearch(open ? debounced : "", scoped ? mediaId : null);
  const results = search.data ?? [];

  const choose = async (c) => {
    setPicking(true);
    let full = null;
    try {
      // Best-effort enrichment — the roster/search payloads omit the
      // description to stay light; this single cached call fills it in.
      full = await api.get(`/external/anilist/character/${c.id}`);
    } catch {
      /* keep the lightweight fields if enrichment fails */
    }
    onPick({
      anilistId: c.id,
      full: c.name?.full,
      native: c.name?.native,
      portraitUrl: c.image?.large ?? c.image?.medium,
      description: full?.description ?? null,
      siteUrl: full?.siteUrl ?? null,
    });
    setPicking(false);
    setOpen(false);
    setQuery("");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors"
      >
        ↳ {t("addfig.lookup_anilist_char")}
      </button>
    );
  }

  // Scoped mode allows an empty query (shows the roster); free mode needs ≥2.
  const tooShort = !scoped && debounced.length < 2;

  return (
    <div className="mt-2 border border-[var(--color-or)]/30 bg-[var(--color-noir)]/60 p-3">
      <div className="flex items-center gap-2 mb-1">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addfig.lookup_char_placeholder")}
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

      {scoped ? (
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/80 mb-2">
          {t("addfig.lookup_char_scoped", { series: seriesLabel || "—" })}
        </p>
      ) : null}

      {tooShort ? (
        <p className="text-xs text-[var(--color-ivoire-soft)] italic">
          {t("addfig.lookup_min")}
        </p>
      ) : search.isLoading || picking ? (
        <p className="text-xs text-[var(--color-ivoire-soft)]">…</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-[var(--color-ivoire-soft)] italic">
          {t("addfig.lookup_no_results")}
        </p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {results.map((c) => {
            const portrait = c.image?.medium ?? c.image?.large;
            const mediaTitles = (c.media ?? [])
              .map((m) => m.title?.romaji ?? m.title?.english ?? m.title?.native)
              .filter(Boolean)
              .slice(0, 2)
              .join(" · ");
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => choose(c)}
                  className="w-full text-left px-2 py-1.5 hover:bg-[var(--color-or)]/10 transition-colors flex items-center gap-2.5"
                >
                  <span className="shrink-0 w-8 h-8 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/20 overflow-hidden">
                    {portrait ? (
                      <img
                        src={portrait}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block display text-sm text-[var(--color-ivoire)] truncate">
                      {c.name?.full ?? c.name?.native ?? "—"}
                    </span>
                    {/* Free search: show the media for disambiguation.
                        Scoped search: native name (we already know the series). */}
                    {mediaTitles ? (
                      <span className="block text-xs text-[var(--color-ivoire-soft)] truncate">
                        {mediaTitles}
                      </span>
                    ) : c.name?.native && c.name.native !== c.name.full ? (
                      <span className="block text-xs text-[var(--color-ivoire-soft)] truncate">
                        {c.name.native}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
