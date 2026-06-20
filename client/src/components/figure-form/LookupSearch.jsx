import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, ArrowUpRight } from "lucide-react";
import { Input } from "../ui/index.js";
import { useProxyEnabled } from "../../hooks/useProxy.js";
import { isUrl, runSearch, searchSources } from "./lookupSources.js";

/**
 * The "Recherche" tab body: a debounced name-search field over orzgk (always)
 * + the proxy boutiques (when configured), a supported-shops chip row, and the
 * result list. Picking a row hands its `(source, detail_url, row)` back up so
 * the parent modal can open the unified detail wizard (or fast-import a
 * detail-less row). A pasted product URL is surfaced as a hint and routed by
 * the parent — this panel only does the name search.
 *
 * @param {object} props
 * @param {string} props.query
 * @param {(q: string) => void} props.onQueryChange
 * @param {(row: object) => void} props.onPickRow   row carries `.source`
 * @param {(node) => void} [props.inputRef]
 */
export default function LookupSearch({ query, onQueryChange, onPickRow, t }) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const inputRef = useRef(null);
  const proxy = useProxyEnabled();
  const sources = useMemo(() => searchSources(proxy.stores), [proxy.stores]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 320ms debounce.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 320);
    return () => clearTimeout(id);
  }, [query]);

  // Name search — URLs are handled by the parent (detail wizard), so suppress.
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (isUrl(q) || q.length < 2) {
      setResults([]);
      setErrors([]);
      setBusy(false);
      return undefined;
    }
    let cancelled = false;
    setBusy(true);
    setErrors([]);
    runSearch(q, { proxyEnabled: proxy.enabled }).then(({ rows, errors }) => {
      if (cancelled) return;
      setResults(rows);
      setErrors(errors);
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, proxy.enabled]);

  // Hover-to-enlarge: a floating preview portaled to <body> so the scroll
  // container can't clip it.
  const [preview, setPreview] = useState(null);
  const showPreview = (src, el) => {
    if (!src || !el) {
      setPreview(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const SIZE = 256;
    const GAP = 12;
    let left = r.right + GAP;
    if (left + SIZE > window.innerWidth - 8) left = r.left - GAP - SIZE;
    left = Math.max(8, left);
    const top = Math.min(
      Math.max(8, r.top + r.height / 2 - SIZE / 2),
      window.innerHeight - SIZE - 8,
    );
    setPreview({ src, top, left, size: SIZE });
  };

  const trimmed = query.trim();

  return (
    <div className="space-y-4">
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
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("lookup.figure.placeholder")}
          className="pl-9"
          aria-label={t("lookup.figure.placeholder")}
        />
      </div>

      {/* Supported shops — where the search hits + what links can be pasted. */}
      <div>
        <p className="micro-tight text-[var(--color-or-pale)] mb-2 flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--accent)] text-xs leading-none">
            店
          </span>
          {t("lookup.figure.sources_label")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <SourceLink key={s.id} name={s.name} href={s.href} />
          ))}
          {proxy.loading ? (
            <span className="self-center px-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--on-surface-subtle)]">
              …
            </span>
          ) : null}
        </div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--on-surface-subtle)] mt-2 leading-relaxed">
          {t("lookup.figure.sources_note")}
        </p>
      </div>

      {/* Result states. */}
      {isUrl(trimmed) ? (
        <p className="text-xs text-[var(--color-or-pale)] italic">
          {t("lookup.figure.url_detected")}
        </p>
      ) : busy ? (
        <div
          role="status"
          className="flex items-center gap-3 py-4 text-xs text-[var(--on-surface-muted)]"
        >
          <span className="flex gap-1" aria-hidden>
            <span
              className="w-1.5 h-1.5 rotate-45 bg-[var(--accent)] animate-pulse"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-1.5 h-1.5 rotate-45 bg-[var(--accent)] animate-pulse"
              style={{ animationDelay: "160ms" }}
            />
            <span
              className="w-1.5 h-1.5 rotate-45 bg-[var(--accent)] animate-pulse"
              style={{ animationDelay: "320ms" }}
            />
          </span>
          <span>{t("lookup.figure.searching")}</span>
        </div>
      ) : debouncedQuery.trim().length < 2 ? (
        <p className="text-xs text-[var(--on-surface-muted)] italic">
          {t("lookup.figure.hint_min")}
        </p>
      ) : results.length === 0 ? (
        <p className="text-xs text-[var(--on-surface-muted)] italic">
          {t("lookup.figure.no_results")}
        </p>
      ) : (
        <ul className="space-y-2 max-h-[min(60vh,28rem)] overflow-y-auto pr-1">
          {results.map((r, i) => (
            <li key={`${r.source}-${i}-${r.detail_url ?? r.mfc_id ?? i}`}>
              <ResultRow row={r} onPreview={showPreview} onPick={() => onPickRow(r)} t={t} />
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 ? (
        <ul role="alert" className="space-y-1.5">
          {errors.map((e) => (
            <li key={e.source} className="flex items-start gap-2 text-xs text-[var(--danger)]">
              <span className="shrink-0 mt-px font-mono text-[9px] uppercase tracking-[0.15em] px-1.5 py-0.5 border border-[var(--danger)]/40">
                {e.source === "proxy" ? "Proxy" : "orzgk"}
              </span>
              <span className="leading-snug">{e.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {preview
        ? createPortal(
            <div
              className="fixed pointer-events-none border border-[var(--border-strong)] bg-[var(--surface-sunken)]"
              style={{
                zIndex: "calc(var(--z-modal) + 10)",
                top: preview.top,
                left: preview.left,
                width: preview.size,
                height: preview.size,
                boxShadow: "var(--elevation-4)",
              }}
              aria-hidden
            >
              <img src={preview.src} alt="" className="w-full h-full object-contain" />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** A supported-shop chip that opens the shop homepage in a new tab. */
function SourceLink({ name, href }) {
  if (!href) {
    return (
      <span className="inline-flex items-center px-2 py-1 text-[11px] border border-[var(--border-subtle)] text-[var(--on-surface-muted)]">
        {name}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-[var(--border)] text-[var(--on-surface-muted)] hover:border-[var(--border-strong)] hover:text-[var(--accent)] transition-colors"
    >
      {name}
      <ArrowUpRight
        size={11}
        className="opacity-70 group-hover:opacity-100 transition-opacity"
        aria-hidden
      />
    </a>
  );
}

function ResultRow({ row, onPick, onPreview, t }) {
  const isOrzgk = row.source === "orzgk";
  const isProxy = row.source === "proxy";
  const sourceLabel = isOrzgk ? "ORZGK" : isProxy ? row.studio || "BOUTIQUE" : "MFC";
  const showStudio = row.studio && !isProxy;
  const shopUrl = row.detail_url ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        className="w-full text-left flex items-start gap-3 p-2 pr-14 min-h-[44px] hover:bg-[var(--accent)]/8 border border-transparent hover:border-[var(--border)] transition-colors"
      >
        <span
          className="shrink-0 w-14 h-14 bg-[var(--surface-sunken)] border border-[var(--border-subtle)] overflow-hidden"
          onMouseEnter={
            row.image_url ? (e) => onPreview?.(row.image_url, e.currentTarget) : undefined
          }
          onMouseLeave={row.image_url ? () => onPreview?.(null) : undefined}
        >
          {row.image_url ? (
            <img src={row.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`chip text-[8.5px] ${isOrzgk ? "" : "chip--laque"}`}
              style={{ padding: "0.1em 0.45em" }}
            >
              {sourceLabel}
            </span>
            {showStudio ? (
              <span className="font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/80 uppercase">
                {row.studio}
              </span>
            ) : null}
            {row.status ? (
              <span className="font-mono text-[9px] tracking-wider text-[var(--on-surface-subtle)] uppercase">
                · {row.status}
              </span>
            ) : null}
          </span>
          <span className="block display text-base text-[var(--on-surface)] mt-1 leading-tight line-clamp-2">
            {row.title ?? row.name}
          </span>
          <span className="block text-[10px] mt-1 text-[var(--on-surface-muted)] flex flex-wrap gap-x-3">
            {row.scale ? <span>{row.scale}</span> : null}
            {row.price_range ? (
              <span className="text-[var(--color-or-pale)]/80">{row.price_range}</span>
            ) : null}
          </span>
        </span>
      </button>
      {shopUrl ? (
        <a
          href={shopUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t("lookup.figure.open_shop")}
          className="group/voir absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-[0.12em] border border-[var(--border)] bg-[var(--surface)]/75 text-[var(--color-or-pale)] hover:border-[var(--border-strong)] hover:text-[var(--accent)] transition-colors"
        >
          {t("lookup.figure.view")}
          <ArrowUpRight
            size={10}
            className="opacity-70 group-hover/voir:opacity-100 transition-opacity"
            aria-hidden
          />
        </a>
      ) : null}
    </div>
  );
}
