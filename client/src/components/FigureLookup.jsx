import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { api, ApiError } from "../lib/api.js";
import Button from "./Button.jsx";

/**
 * Inline lookup panel that searches external providers for a figurine by
 * name, then opens a detail modal where the user picks (a) a version and
 * (b) a price. The full payload is then handed back to the form.
 *
 * Two entry points:
 *  1. Search (debounced 320 ms) against orzgk + MFC.
 *  2. **URL paste** — drop an orzgk product link in the search field and
 *     the panel jumps straight to detail fetch, bypassing search.
 *
 * Cache is server-side (24h TTL on `external_lookups`).
 *
 * @param {object} props
 * @param {string} [props.initial=""]
 * @param {(pick: object) => void} props.onPick
 *   Receives a normalised payload the form can spread into its state:
 *     { name, manufacturer_name, series_name, character_name, figure_type,
 *       scale, official_image_url, version_name, msrp_amount, msrp_currency,
 *       release_date, is_nsfw, description }
 */
export default function FigureLookup({ initial = "", onPick }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initial);
  const [debouncedQuery, setDebouncedQuery] = useState(initial);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mfcNotice, setMfcNotice] = useState(null);
  const inputRef = useRef(null);

  // Detail-flow state (when a card is clicked or a URL is pasted).
  const [detailFor, setDetailFor] = useState(null); // url string, or null
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // 320ms debounce on the search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 320);
    return () => clearTimeout(id);
  }, [query]);

  // Detect when the user pastes an orzgk product URL → jump to detail.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (ORZGK_URL_RE.test(trimmed) && trimmed !== detailFor) {
      openDetail(trimmed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  // Trigger search when the panel is open AND the debounced query is non-URL
  // AND long enough. Providers fire in parallel; whichever fails just shows
  // a note, never breaks the result list from the other.
  useEffect(() => {
    if (!open) return;
    const q = debouncedQuery.trim();
    if (ORZGK_URL_RE.test(q)) {
      // URL paste handled separately by the effect above.
      setResults([]);
      setError(null);
      setMfcNotice(null);
      return;
    }
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setMfcNotice(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    setMfcNotice(null);

    const calls = [
      api.get(`/external/orzgk/search?q=${encodeURIComponent(q)}`).then(
        (rows) => rows.map((r) => ({ ...r, source: "orzgk" })),
        (e) => {
          if (cancelled) return [];
          setError(e?.message ?? "orzgk failed");
          return [];
        },
      ),
      api.get(`/external/mfc/search?q=${encodeURIComponent(q)}`).then(
        (rows) => rows.map((r) => ({ ...r, source: "mfc" })),
        (e) => {
          if (cancelled) return [];
          if (e instanceof ApiError && e.code === "feature_disabled") {
            setMfcNotice(e.message);
          }
          return [];
        },
      ),
    ];

    Promise.all(calls).then((lists) => {
      if (cancelled) return;
      setResults(lists.flat());
      setBusy(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, debouncedQuery]);

  const onOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  // Monotonically-incrementing token: each `openDetail` call captures the
  // current token + bumps it. When the fetch resolves, we only write to
  // state if our token is still the latest. This invalidates stale
  // completions when the user types/clears around a URL fast enough to
  // chain calls — without it, a slow earlier fetch could clobber a fresh
  // later one and re-render the dialog with the wrong product.
  const detailReqRef = useRef(0);
  const openDetail = (url) => {
    const myReq = ++detailReqRef.current;
    setDetailFor(url);
    setDetail(null);
    setDetailError(null);
    setDetailBusy(true);
    api
      .get(`/external/orzgk/detail?url=${encodeURIComponent(url)}`)
      .then((d) => {
        if (detailReqRef.current !== myReq) return; // a newer call superseded us
        setDetail(d);
        setDetailBusy(false);
      })
      .catch((e) => {
        if (detailReqRef.current !== myReq) return;
        setDetailError(e?.message ?? "Detail fetch failed");
        setDetailBusy(false);
      });
  };

  const closeDetail = () => {
    setDetailFor(null);
    setDetail(null);
    setDetailError(null);
    setDetailBusy(false);
  };

  const applyPick = (payload) => {
    onPick(payload);
    closeDetail();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors mt-2"
      >
        ↳ {t("lookup.figure.open")}
      </button>
    );
  }

  return (
    <>
      <div className="mt-3 p-4 border border-[var(--color-or)]/25 bg-[var(--color-noir)]/40">
        <div className="flex items-center gap-2 mb-3">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("lookup.figure.placeholder")}
            className="flex-1 bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-3 py-2 text-sm text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors px-2 py-1"
          >
            ✕
          </button>
        </div>

        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/60 mb-3">
          {t("lookup.figure.paste_hint")}
        </p>

        {ORZGK_URL_RE.test(query.trim()) ? (
          // URL paste mode — keep the panel quiet, the modal does the work.
          <p className="text-xs text-[var(--color-or-pale)] italic">
            {t("lookup.figure.url_detected")}
          </p>
        ) : busy ? (
          <p className="text-xs text-[var(--color-ivoire-soft)] italic">…</p>
        ) : debouncedQuery.trim().length < 2 ? (
          <p className="text-xs text-[var(--color-ivoire-soft)] italic">
            {t("lookup.figure.hint_min")}
          </p>
        ) : results.length === 0 ? (
          <p className="text-xs text-[var(--color-ivoire-soft)] italic">
            {t("lookup.figure.no_results")}
          </p>
        ) : (
          <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {results.map((r, i) => (
              <li key={`${r.source}-${i}-${r.detail_url ?? r.mfc_id ?? i}`}>
                <ResultRow
                  row={r}
                  onPick={() => {
                    if (r.source === "orzgk" && r.detail_url) {
                      openDetail(r.detail_url);
                    } else {
                      // MFC or detail-less row: keep the legacy minimal apply.
                      applyPick(legacyPick(r, t));
                    }
                  }}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p
            role="alert"
            className="mt-3 text-xs text-[var(--color-laque-bright)]"
          >
            {error}
          </p>
        ) : null}

        {mfcNotice ? (
          <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/70 border-t border-[var(--color-or)]/15 pt-2">
            MFC · {mfcNotice}
          </p>
        ) : null}
      </div>

      {detailFor ? (
        <OrzgkDetailModal
          url={detailFor}
          detail={detail}
          busy={detailBusy}
          error={detailError}
          onClose={closeDetail}
          onApply={applyPick}
          t={t}
        />
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Result card

function ResultRow({ row, onPick, t }) {
  const isOrzgk = row.source === "orzgk";

  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full text-left flex items-start gap-3 p-2 hover:bg-[var(--color-or)]/8 border border-transparent hover:border-[var(--color-or)]/25 transition-all"
    >
      <span className="shrink-0 w-14 h-14 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden">
        {row.image_url ? (
          <img
            src={row.image_url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`chip text-[8.5px] ${isOrzgk ? "" : "chip--laque"}`}
            style={{ padding: "0.1em 0.45em" }}
          >
            {isOrzgk ? "ORZGK" : "MFC"}
          </span>
          {row.studio ? (
            <span className="font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/80 uppercase">
              {row.studio}
            </span>
          ) : null}
          {row.status ? (
            <span className="font-mono text-[9px] tracking-wider text-[var(--color-ivoire-soft)]/70 uppercase">
              · {row.status}
            </span>
          ) : null}
        </span>
        <span className="block display text-base text-[var(--color-ivoire)] mt-1 leading-tight line-clamp-2">
          {row.title ?? row.name}
        </span>
        <span className="block text-[10px] mt-1 text-[var(--color-ivoire-soft)] flex flex-wrap gap-x-3">
          {row.scale ? <span>{row.scale}</span> : null}
          {row.price_range ? (
            <span className="text-[var(--color-or-pale)]/80">
              {row.price_range}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail modal — Versions → Prices → Apply

function OrzgkDetailModal({ url, detail, busy, error, onClose, onApply, t }) {
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedPrice, setSelectedPrice] = useState(null);
  const [step, setStep] = useState("version"); // "version" | "price"

  // Initialise selection when detail arrives.
  useEffect(() => {
    if (!detail) return;
    if (detail.versions?.length) {
      // Multiple versions: start at version-picking step.
      setStep("version");
      setSelectedVersion(detail.versions.length === 1 ? detail.versions[0] : null);
      setSelectedPrice(null);
    } else {
      // No versions: skip directly to price-picking (or auto-pick single).
      setStep("price");
      setSelectedVersion(null);
      if (detail.prices?.length === 1) {
        setSelectedPrice(detail.prices[0]);
      } else {
        setSelectedPrice(null);
      }
    }
  }, [detail]);

  // When the user picks a version with only one price, auto-pick it too.
  useEffect(() => {
    if (!selectedVersion) return;
    if (selectedVersion.prices?.length === 1) {
      setSelectedPrice(selectedVersion.prices[0]);
    }
  }, [selectedVersion]);

  // Esc closes the modal.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const versionPrices = selectedVersion?.prices ?? detail?.prices ?? [];

  const canApply = useMemo(() => {
    if (!detail) return false;
    if (detail.versions?.length && !selectedVersion) return false;
    if (versionPrices.length > 0 && !selectedPrice) return false;
    return true;
  }, [detail, selectedVersion, selectedPrice, versionPrices.length]);

  const handleApply = () => {
    if (!detail) return;
    onApply(buildPick(detail, selectedVersion, selectedPrice));
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="orzgk-detail-title"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 w-[95vw] max-w-4xl max-h-[92vh] flex flex-col frame-corners"
        style={{
          boxShadow:
            "0 60px 120px -50px rgba(0,0,0,0.85), inset 0 1px 0 oklch(0.92 0.03 75 / 0.06)",
        }}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-[var(--color-or)]/20">
          <div className="min-w-0">
            <p className="micro-tight">{t("lookup.figure.detail.eyebrow")}</p>
            <h2
              id="orzgk-detail-title"
              className="display text-2xl text-[var(--color-ivoire)] mt-1 leading-tight truncate"
            >
              {detail?.title ?? t("lookup.figure.detail.loading")}
            </h2>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/60 mt-1 truncate">
              {url}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xl leading-none px-2 py-1 -mt-1"
          >
            ✕
          </button>
        </header>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {busy ? (
            <p className="text-sm text-[var(--color-ivoire-soft)] italic py-8 text-center">
              {t("lookup.figure.detail.loading")}
            </p>
          ) : error ? (
            <p
              role="alert"
              className="text-sm text-[var(--color-laque-bright)] py-4"
            >
              {error}
            </p>
          ) : detail ? (
            <div className="grid md:grid-cols-[200px_1fr] gap-6">
              {/* Image preview */}
              <div className="space-y-3">
                <div className="aspect-square bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden">
                  {pickImage(detail, selectedVersion) ? (
                    <img
                      src={pickImage(detail, selectedVersion)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                {detail.images?.length > 1 ? (
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/60">
                    {detail.images.length}{" "}
                    {t("lookup.figure.detail.images_count")}
                  </p>
                ) : null}
              </div>

              {/* Spec rows + step UI */}
              <div className="space-y-5">
                <SpecGrid detail={detail} t={t} />

                {/* Stepper */}
                {detail.versions?.length ? (
                  <Step
                    n={1}
                    label={t("lookup.figure.detail.step_version")}
                    active={step === "version"}
                    done={!!selectedVersion}
                  >
                    <VersionPicker
                      versions={detail.versions}
                      selected={selectedVersion}
                      onSelect={(v) => {
                        setSelectedVersion(v);
                        setSelectedPrice(null);
                        setStep("price");
                      }}
                    />
                  </Step>
                ) : null}

                <Step
                  n={detail.versions?.length ? 2 : 1}
                  label={t("lookup.figure.detail.step_price")}
                  active={step === "price" || !detail.versions?.length}
                  done={!!selectedPrice}
                >
                  {versionPrices.length === 0 ? (
                    <p className="text-xs text-[var(--color-ivoire-soft)] italic">
                      {t("lookup.figure.detail.no_prices")}
                    </p>
                  ) : (
                    <PricePicker
                      prices={versionPrices}
                      selected={selectedPrice}
                      onSelect={setSelectedPrice}
                      t={t}
                    />
                  )}
                </Step>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-or)]/20">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canApply}
            onClick={handleApply}
          >
            {t("lookup.figure.detail.apply")}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-UI bits

function SpecGrid({ detail, t }) {
  // We prefer description-mined values when both are present: `product_ip`
  // is much cleaner than `from` ("One Punch Man" vs "Anime Figure - One Punch
  // Man"), `product_role` mirrors `character`, etc. Falls back to the spec
  // row when only that's available.
  const series = detail.product_ip ?? detail.origin;
  const character = detail.product_role ?? detail.character;
  const rows = [
    ["brand", detail.brand],
    ["origin", series],
    ["character", character],
    ["kind", detail.kind],
    ["scale", detail.scale],
    ["size", detail.size],
    ["height_mm", detail.height_mm ? `${detail.height_mm} mm` : null],
    ["height_range", detail.height_range],
    ["material", detail.product_material],
    ["feature", detail.feature],
    ["limited_units", detail.limited_units],
    ["preorder_start_date", detail.preorder_start_date],
    ["est_completion", detail.est_completion ?? detail.est_released_time],
    ["special_description", detail.special_description],
  ].filter(([_, v]) => !!v);

  if (rows.length === 0) return null;

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 border border-[var(--color-or)]/15 bg-[var(--color-noir)]/40 px-4 py-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 items-baseline">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/80 shrink-0 w-[112px]">
            {t(`lookup.figure.detail.field.${k}`)}
          </dt>
          <dd className="text-sm text-[var(--color-ivoire)] min-w-0 truncate">
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Step({ n, label, active, done, children }) {
  return (
    <section
      className={`border-l-2 pl-4 ${
        done
          ? "border-[var(--color-or)]/60"
          : active
          ? "border-[var(--color-or)]"
          : "border-[var(--color-or)]/20"
      }`}
    >
      <p className="micro-tight flex items-center gap-2">
        <span
          className={`inline-flex items-center justify-center w-5 h-5 border ${
            done
              ? "bg-[var(--color-or)] text-[var(--color-noir)] border-[var(--color-or)]"
              : active
              ? "border-[var(--color-or)] text-[var(--color-or)]"
              : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)]"
          } text-[10px] font-mono`}
        >
          {done ? "✓" : n}
        </span>
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function VersionPicker({ versions, selected, onSelect }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {versions.map((v) => {
        const isSelected = selected?.key === v.key;
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onSelect(v)}
            className={`flex items-center gap-3 p-2 border text-left transition-all ${
              isSelected
                ? "border-[var(--color-or)] bg-[var(--color-or)]/10"
                : "border-[var(--color-or)]/25 hover:border-[var(--color-or)]/60 hover:bg-[var(--color-or)]/5"
            }`}
          >
            <span className="shrink-0 w-12 h-12 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden">
              {v.image_url ? (
                <img
                  src={v.image_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-[var(--color-ivoire)] leading-tight">
                {v.label}
              </span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/70 mt-1">
                {v.prices.length}{" "}
                {v.prices.length === 1 ? "tariff" : "tariffs"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PricePicker({ prices, selected, onSelect, t }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {prices.map((p, i) => {
        const isSelected = selected === p;
        return (
          <button
            key={`${p.label}-${i}-${p.display}`}
            type="button"
            onClick={() => onSelect(p)}
            className={`flex items-baseline justify-between gap-3 p-3 border text-left transition-all ${
              isSelected
                ? "border-[var(--color-or)] bg-[var(--color-or)]/10"
                : "border-[var(--color-or)]/25 hover:border-[var(--color-or)]/60 hover:bg-[var(--color-or)]/5"
            }`}
          >
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/80">
              {paymentLabel(p.label, t)}
            </span>
            <span className="display text-lg text-[var(--color-ivoire)]">
              {p.display}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping detail+selection → form payload

const ORZGK_URL_RE = /^https?:\/\/(www\.)?orzgk\.com\/product\//i;

const TYPE_MAP = {
  "gk statue": "statue",
  "pvc figure": "scale",
  "scale figure": "scale",
  nendoroid: "nendoroid",
  figma: "figma",
  "prize figure": "prize",
  prize: "prize",
  "trading figure": "trading",
  "plastic model": "plamo",
  bishoujo: "bishoujo",
  dakimakura: "dakimakura",
};

function mapType(kind) {
  if (!kind) return undefined;
  const key = kind.trim().toLowerCase();
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (key.includes(k)) return v;
  }
  return undefined;
}

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD"];

function mapCurrency(c) {
  if (!c) return undefined;
  const upper = c.toUpperCase();
  return SUPPORTED_CURRENCIES.includes(upper) ? upper : undefined;
}

/** Convert various orzgk date formats into ISO `YYYY-MM-DD`:
 *   - `"2027/12"`        → `"2027-12-01"`
 *   - `"2027/12/15"`     → `"2027-12-15"`
 *   - `"2027 Q4"`        → `"2027-10-01"` (Q1/Q2/Q3/Q4 → 01/04/07/10)
 *   - `"2027"`           → `"2027-01-01"`
 *   - anything else      → `undefined`
 *
 * Tries each candidate string in order and returns the first match — call
 * with the most precise source first (`est_completion`, then `est_released_time`).
 */
function parseReleaseDate(...candidates) {
  for (const raw of candidates) {
    if (!raw) continue;
    const s = String(raw).trim();
    // YYYY/MM[/DD]
    const slash = s.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
    if (slash) {
      return `${slash[1]}-${pad2(slash[2])}-${pad2(slash[3] ?? "01")}`;
    }
    // YYYY QN  /  YYYY-QN
    const quarter = s.match(/^(\d{4})[\s-]*Q([1-4])$/i);
    if (quarter) {
      const month = { 1: "01", 2: "04", 3: "07", 4: "10" }[quarter[2]];
      return `${quarter[1]}-${month}-01`;
    }
    // Plain year
    const year = s.match(/^(\d{4})$/);
    if (year) return `${year[1]}-01-01`;
  }
  return undefined;
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function pickImage(detail, version) {
  return version?.image_url ?? detail?.primary_image_url ?? detail?.images?.[0] ?? null;
}

/** Map an orzgk payment slug to a translated label. Falls back to the raw
 *  slug capitalized when no specific translation exists. */
function paymentLabel(slug, t) {
  const known = ["deposit", "full"];
  if (known.includes(slug)) {
    return t(`lookup.figure.detail.payment.${slug}`);
  }
  // Unknown payment slug — humanise as a courtesy.
  return slug
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildPick(detail, version, price) {
  // NSFW heuristic: orzgk uses "18+" on adult listings; some pages also use
  // "Adult", "R-18". Either source (spec row or description-mined) works.
  const feature = (detail.feature ?? "").toLowerCase();
  const isNsfw =
    feature.includes("18+") ||
    feature.includes("adult") ||
    feature.includes("r-18") ||
    feature.includes("r18");

  // The description block has cleaner alternates to several spec rows —
  // prefer them when available. `From:` famously returns "Anime Figure - One
  // Punch Man", `Product IP:` returns just "One Punch Man".
  const series = detail.product_ip ?? detail.origin;
  const character = detail.product_role ?? detail.character;

  const descLines = [];
  if (detail.url) descLines.push(`Source: ${detail.url}`);
  if (detail.kind) descLines.push(`Type: ${detail.kind}`);
  if (detail.size) descLines.push(`Size: ${detail.size}`);
  if (detail.height_range) descLines.push(`Height range: ${detail.height_range}`);
  if (detail.feature) descLines.push(`Feature: ${detail.feature}`);
  if (detail.limited_units) descLines.push(`Limited edition: ${detail.limited_units}`);
  if (detail.preorder_start_date)
    descLines.push(`Pre-order: ${detail.preorder_start_date}`);
  if (detail.est_completion)
    descLines.push(`Est. completion: ${detail.est_completion}`);
  else if (detail.est_released_time)
    descLines.push(`Est. release: ${detail.est_released_time}`);
  if (detail.product_material)
    descLines.push(`Material: ${detail.product_material}`);
  if (detail.special_description)
    descLines.push(`Special: ${detail.special_description}`);
  if (version) descLines.push(`Version: ${version.label}`);
  if (price) descLines.push(`Tariff: ${price.display} (${price.label})`);

  return {
    name: detail.title,
    manufacturer_name: detail.brand,
    series_name: series,
    character_name: character,
    figure_type: mapType(detail.kind),
    scale: detail.scale,
    height_mm: detail.height_mm ? String(detail.height_mm) : undefined,
    materials: detail.product_material,
    // The orzgk URL the user pasted — the backend uses its hostname to
    // auto-link the new figure to the matching store at create time.
    source_url: detail.url,
    // Limited editions: surface the count via the `edition` field; the
    // exclusivity slot is reserved for retailer / channel exclusives.
    edition: detail.limited_units
      ? `Limited ${detail.limited_units}`
      : undefined,
    official_image_url: pickImage(detail, version),
    version_name: version?.label,
    msrp_amount: price?.amount ? String(price.amount.toFixed(2)) : undefined,
    msrp_currency: mapCurrency(price?.currency),
    release_date: parseReleaseDate(detail.est_completion, detail.est_released_time),
    is_nsfw: isNsfw || undefined,
    description: descLines.length ? descLines.join("\n") : undefined,
  };
}

/** Minimal payload for the (now legacy) MFC route shape — kept so users
 *  picking an MFC result still get *something* into the form even when the
 *  detail flow doesn't apply. */
function legacyPick(row, t) {
  return {
    name: row.title ?? row.name ?? "",
    manufacturer_name: row.studio ?? row.manufacturer ?? undefined,
    scale: row.scale ?? undefined,
    official_image_url: row.image_url ?? row.official_image_url ?? undefined,
    character_name: row.character ?? undefined,
    series_name: row.origin ?? undefined,
    jan: row.jan ?? undefined,
    description: row.detail_url
      ? `${t("lookup.figure.source_prefix")} ${row.detail_url}`
      : undefined,
    source_url: row.detail_url,
  };
}
