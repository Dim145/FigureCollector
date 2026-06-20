import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "../ui/index.js";
import { useAniListSearch } from "../../hooks/useAniList.js";

/**
 * AniList (series) tab body. Searches AniList media and, on pick, hands back a
 * figure-form prefill that fills `series_name` AND carries the `series_meta`
 * enrichment (anilist_id, description, cover…) the server persists on first
 * insert. This mirrors the inline `<AniListLookup>` next to the Series field —
 * offered here too so the lookup modal is a one-stop "pre-fill from a source".
 *
 * Character-level AniList enrichment stays inline in the form (it needs the
 * picked series for roster scoping), so this tab is series-only.
 *
 * @param {(payload: object) => void} props.onPick
 * @param {string} [props.initial]
 * @param {(key, opts?) => string} props.t
 */
export default function LookupAniList({ onPick, initial = "", t }) {
  const [query, setQuery] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const search = useAniListSearch(debounced);
  const results = search.data ?? [];

  const pick = (m) => {
    const name = m.title?.romaji ?? m.title?.english ?? m.title?.native;
    onPick({
      series_name: name,
      series_meta: {
        anilist_id: m.id,
        mal_id: m.idMal,
        description: stripHtmlSafe(m.description),
        cover_url: m.coverImage?.large ?? m.coverImage?.medium,
        external_url: m.siteUrl,
        origin: anilistTypeToOrigin(m.type),
      },
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--border-strong)] pl-3">
        {t("lookup.figure.anilist_note", {
          default:
            "Cherche la série sur AniList pour renseigner l'origine et enrichir la fiche (description, visuel). Le personnage se précise ensuite dans le formulaire.",
        })}
      </p>

      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-subtle)]"
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addfig.lookup_placeholder")}
          className="pl-9"
          aria-label={t("addfig.lookup_anilist")}
        />
      </div>

      {debounced.length < 2 ? (
        <p className="text-xs text-[var(--on-surface-muted)] italic">{t("addfig.lookup_min")}</p>
      ) : search.isLoading ? (
        <p className="text-xs text-[var(--on-surface-muted)]">…</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-[var(--on-surface-muted)] italic">
          {t("addfig.lookup_no_results")}
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-[min(60vh,28rem)] overflow-y-auto pr-1">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m)}
                className="w-full text-left px-3 py-2 min-h-[44px] border border-transparent hover:bg-[var(--accent)]/8 hover:border-[var(--border)] transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="display text-sm text-[var(--on-surface)]">
                    {m.title?.romaji ?? m.title?.english ?? m.title?.native ?? "—"}
                  </span>
                  {m.type ? <span className="micro shrink-0 opacity-70">{m.type}</span> : null}
                </div>
                {m.title?.english && m.title.english !== m.title.romaji ? (
                  <p className="text-xs text-[var(--on-surface-muted)] mt-0.5">{m.title.english}</p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Map AniList media type → our `series.origin` enum. */
function anilistTypeToOrigin(mediaType) {
  if (!mediaType) return undefined;
  const upper = String(mediaType).toUpperCase();
  if (upper === "ANIME") return "anime";
  if (upper === "MANGA") return "manga";
  return undefined;
}

/** Cheap HTML strip for AniList descriptions (no DOMPurify dep). Single-char
 *  bracket strip avoids the smuggleable multi-char-sanitization pattern. */
function stripHtmlSafe(s) {
  if (!s) return undefined;
  return (
    String(s)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/[<>]/g, "")
      .trim() || undefined
  );
}
