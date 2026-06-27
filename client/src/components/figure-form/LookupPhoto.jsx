import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { api } from "../../lib/api.js";
import { embedImage, hasWebGPU, warmUp } from "../../lib/embed.js";
import { resolveFigureCover } from "../../lib/coverUrl.js";
import { useVisualSearchStatus } from "../../hooks/useVisualSearch.js";

/**
 * "Photo" tab body. Reuses the exact /recognize pipeline INSIDE the lookup
 * modal: the chosen photo is embedded in-browser (DINOv2-small, WebGPU→WASM)
 * and only the 384-d vector is sent to `POST /me/visual-search`; pgvector
 * returns the nearest catalog figures. Picking one maps the matched catalogue
 * figure into the shared figure-form prefill payload and hands it to `onPick`.
 *
 * The photo never leaves the device (the embedding is anonymous). Gated on the
 * same `visual_search.status.enabled` flag the /recognize page + nav use; when
 * off, a short disabled note replaces the uploader (manual entry stays the
 * other tabs / the form itself — the hard product rule).
 *
 * @param {(payload: object) => void} props.onPick  receives the prefill payload
 * @param {(key, opts?) => string} props.t
 */
export default function LookupPhoto({ onPick, t }) {
  const { data: status } = useVisualSearchStatus(); // shared cache with the nav
  const [previewUrl, setPreviewUrl] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | preparing | analysing
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null); // null | [] | [candidates]
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const enabled = status ? status.enabled : undefined;

  // Warm the model the moment the tab opens (and the feature is on), so the
  // first capture doesn't wait on the ~23 MB download + init.
  useEffect(() => {
    if (enabled) warmUp();
  }, [enabled]);

  // Revoke the object URL when it changes / on unmount (no leaked blobs).
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // Embed the chosen photo in the browser, then search the catalog. Same flow
  // as RecognizePage.onFile (minus the off-device external fallback, which
  // belongs on the dedicated page, not the quick add-modal).
  const onFile = useCallback(
    async (file) => {
      if (!file) return;
      setError(null);
      setResults(null);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      try {
        setPhase("preparing");
        setProgress(0);
        const embedding = await embedImage(file, (p) => {
          if (p?.status === "progress" && p.total) {
            setProgress(Math.round((p.loaded / p.total) * 100));
          } else if (p?.status === "ready" || p?.status === "done") {
            setPhase("analysing");
          }
        });
        setPhase("analysing");
        const candidates = await api.post("/me/visual-search", { embedding });
        setResults(Array.isArray(candidates) ? candidates : []);
        setPhase("idle");
      } catch (e) {
        setError(e?.message ?? t("recognize.error"));
        setPhase("idle");
      }
    },
    [t],
  );

  const busy = phase !== "idle";

  // Disabled state — mirrors RecognizePage's gated branch (short note, no
  // uploader). Manual entry stays available on the other tabs / the form.
  if (enabled === false) {
    return (
      <p
        role="status"
        className="text-[12px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--border-strong)] pl-3"
      >
        {t("lookup.figure.photo_disabled", {
          default:
            "La recherche par photo n'est pas activée sur cette instance. Renseignez la fiche à la main ou via une autre source.",
        })}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--border-strong)] pl-3">
        {t("lookup.figure.photo_note", {
          default:
            "Photographiez la figurine : l'empreinte est calculée sur votre appareil, seule une signature anonyme circule pour retrouver la pièce au catalogue.",
        })}
      </p>

      {/* No `capture` attribute on purpose — the browser shows its native
          chooser (Prendre une photo / Galerie), matching RecognizePage. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="group w-full border border-[var(--border-strong)] bg-[var(--accent)]/5 hover:border-[var(--accent)] transition-colors p-6 flex flex-col items-center text-center disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="w-28 h-28 object-cover border border-[var(--border)] mb-3"
          />
        ) : (
          <Camera
            size={28}
            className="text-[var(--color-or-pale)] mb-2 group-hover:text-[var(--accent)] transition-colors"
            aria-hidden
          />
        )}
        <span className="display text-base text-[var(--on-surface)]">
          {previewUrl
            ? t("lookup.figure.photo_retake", { default: "Reprendre une photo" })
            : t("lookup.figure.photo_capture", { default: "Photographier la figurine" })}
        </span>
        <span className="micro-tight mt-1 opacity-80">
          {t("lookup.figure.photo_capture_hint", {
            default: "Appareil photo ou galerie — sur votre appareil uniquement",
          })}
        </span>
      </button>

      {!hasWebGPU() && !busy && results == null ? (
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--on-surface-subtle)] leading-relaxed">
          {t("lookup.figure.photo_wasm_hint", {
            default: "Sans accélération GPU : la première analyse peut prendre quelques secondes.",
          })}
        </p>
      ) : null}

      {/* Progress — mirrors LookupSearch's busy row tone. */}
      {busy ? (
        <div role="status" className="flex items-center gap-3 py-1 text-sm text-[var(--color-or-pale)]">
          <span aria-hidden className="ja animate-pulse text-[var(--accent)]">
            輪
          </span>
          <span>
            {phase === "preparing"
              ? t("lookup.figure.photo_preparing", {
                  pct: progress,
                  default: `Préparation du modèle… ${progress}%`,
                })
              : t("lookup.figure.photo_analysing", { default: "Reconnaissance…" })}
          </span>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {/* Results. */}
      {results != null && !busy ? (
        results.length === 0 ? (
          <p className="text-xs text-[var(--on-surface-muted)] italic">
            {t("lookup.figure.photo_no_match", {
              default: "Aucune correspondance au catalogue. Essayez une autre source ou la saisie manuelle.",
            })}
          </p>
        ) : (
          <div>
            <p className="micro-tight text-[var(--color-or-pale)] mb-2 flex items-center gap-2">
              <span aria-hidden className="ja not-italic text-[var(--accent)] text-xs leading-none">
                候
              </span>
              {t("lookup.figure.photo_candidates", { default: "Candidats — choisissez la bonne" })}
            </p>
            <ul className="space-y-2 max-h-[min(60vh,28rem)] overflow-y-auto pr-1">
              {results.map(({ figure: f, distance }) => (
                <li key={f.id}>
                  <CandidateRow figure={f} distance={distance} onPick={() => onPick(mapFigureToPick(f))} t={t} />
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}

/** Map a catalogue figure (the hydrated `/me/visual-search` match) into the
 *  shared figure-form prefill payload. Field names line up 1:1 with the
 *  `Figure` API shape; `msrp_amount` is stringified because the form stores
 *  every numeric field as a string (its inputs are text), and `source_url`
 *  falls back to the official image URL per the lookup contract. */
function mapFigureToPick(f) {
  return {
    name: f.name,
    manufacturer_name: f.manufacturer_name ?? undefined,
    series_name: f.series_name ?? undefined,
    character_name: f.character_name ?? undefined,
    figure_type: f.figure_type ?? undefined,
    scale: f.scale ?? undefined,
    official_image_url: f.official_image_url ?? undefined,
    version_name: f.version_name ?? undefined,
    msrp_amount: f.msrp_amount != null ? String(f.msrp_amount) : undefined,
    msrp_currency: f.msrp_currency ?? undefined,
    release_date: f.release_date ?? undefined,
    is_nsfw: f.is_nsfw ?? undefined,
    description: f.description ?? undefined,
    jan: f.jan ?? undefined,
    source_url: f.official_image_url ?? null,
  };
}

/** A pickable candidate row: cover thumb + name + manufacturer + match %.
 *  Mirrors LookupSearch.ResultRow's structure/styling (44px tap target). */
function CandidateRow({ figure: f, distance, onPick, t }) {
  const sim = Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
  const cover = resolveFigureCover(f);
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full text-left flex items-start gap-3 p-2 min-h-[44px] hover:bg-[var(--accent)]/8 border border-transparent hover:border-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span className="shrink-0 w-14 h-14 bg-[var(--surface-sunken)] border border-[var(--border-subtle)] overflow-hidden">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="chip text-[8.5px]" style={{ padding: "0.1em 0.45em" }}>
            {t("lookup.figure.photo_match_pct", { pct: sim, default: `${sim}%` })}
          </span>
          {f.manufacturer_name ? (
            <span className="font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/80 uppercase truncate">
              {f.manufacturer_name}
            </span>
          ) : null}
        </span>
        <span className="block display text-base text-[var(--on-surface)] mt-1 leading-tight line-clamp-2">
          {f.name}
        </span>
        <span className="block text-[10px] mt-1 text-[var(--on-surface-muted)] flex flex-wrap gap-x-3">
          {f.scale ? <span>{f.scale}</span> : null}
          {f.version_name ? <span>{f.version_name}</span> : null}
        </span>
      </span>
    </button>
  );
}
