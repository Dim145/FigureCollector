import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useVisualSearchStatus } from "../hooks/useVisualSearch.js";
import { api } from "../lib/api.js";
import { embedImage, hasWebGPU, warmUp } from "../lib/embed.js";
import { resolveFigureCover } from "../lib/coverUrl.js";
import AppShell from "../components/AppShell.jsx";
import AccentTitle from "../components/AccentTitle.jsx";
import FigureCard from "../components/FigureCard.jsx";

/**
 * Downscale a photo to a modest JPEG and return its bare base64 (no data: URL
 * prefix). Sent to the server only for the OPT-IN external lookup — shrinking
 * it first keeps the payload small (less data leaves the device, cheaper API
 * call, faster round-trip). 1024 px is ample for Google's web detection.
 */
async function downscaleToJpegBase64(file, maxDim = 1024, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

/** Bare hostname for a page link label; falls back to the raw URL. */
function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * /recognize — "Reconnaître par photo" (Direction A, Shōjo-Noir).
 *
 * Photograph a figure → the browser embeds it (DINOv2-small via transformers.js,
 * WebGPU→WASM) and only the 384-d vector is sent; pgvector finds the nearest
 * catalog figures, which the user confirms. The photo never leaves the device.
 * Manual entry is always one tap away (the hard product rule).
 */
export default function RecognizePage() {
  const t = useT();
  const me = useMe();
  const { data: status } = useVisualSearchStatus(); // shared cache with the nav
  const [previewUrl, setPreviewUrl] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | preparing | analysing
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null); // null | [] | [candidates]
  const [error, setError] = useState(null);
  const [capturedFile, setCapturedFile] = useState(null); // for the opt-in external lookup
  const [externalPhase, setExternalPhase] = useState("idle"); // idle | searching
  const [externalHints, setExternalHints] = useState(null); // null | WebHints
  const [externalError, setExternalError] = useState(null);
  const fileRef = useRef(null);

  // Warm the model the moment the page opens (and the feature is on), so the
  // first capture doesn't wait on the ~23 MB download + init.
  useEffect(() => {
    if (status?.enabled) warmUp();
  }, [status?.enabled]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const nsfwBlur = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    setResults(null);
    setExternalHints(null);
    setExternalError(null);
    setCapturedFile(file);
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
  };

  // Opt-in: only runs on an explicit tap, AFTER an empty in-catalog result.
  // This is the one path where the photo leaves the device (→ Google Vision).
  const runExternalSearch = async () => {
    if (!capturedFile || externalPhase === "searching") return;
    setExternalError(null);
    setExternalHints(null);
    setExternalPhase("searching");
    try {
      const imageBase64 = await downscaleToJpegBase64(capturedFile);
      const hints = await api.post("/me/visual-search/external", {
        image_base64: imageBase64,
      });
      setExternalHints(hints ?? {});
    } catch {
      // The upstream reason (bad key, quota, transient) isn't actionable for
      // the user and 5xx details are hidden server-side, so show the localized
      // failure line rather than a raw error code.
      setExternalError(t("recognize.external.error"));
    } finally {
      setExternalPhase("idle");
    }
  };

  const busy = phase !== "idle";
  const disabled = status && !status.enabled;
  const externalBusy = externalPhase === "searching";

  return (
    <AppShell>
      <main className="relative max-w-4xl mx-auto px-6 py-16">
        {/* ─── Editorial header ─── */}
        <header className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[20rem] md:text-[24rem] -top-24 -right-6 hidden sm:block select-none"
          >
            視
          </span>
          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("recognize.kicker", { default: "RECONNAÎTRE" })}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">視</span>
            {t("recognize.kicker_label", { default: "PHOTO" })}
          </p>
          <h1
            className="display text-4xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("recognize.title", { default: "Reconnaître par photo" })} />
          </h1>
          <div className="gold-rule w-24 mt-6 reveal" style={{ "--i": 2 }} />
          <p
            className="display-italic text-[var(--color-or)] text-lg mt-5 max-w-xl reveal"
            style={{ "--i": 3 }}
          >
            {t("recognize.gloss", {
              default:
                "Photographie ta figurine — l'empreinte est calculée sur ton appareil, seule une signature anonyme circule pour retrouver la pièce au catalogue.",
            })}
          </p>
        </header>

        {disabled ? (
          <div
            className="reveal border-l-2 border-[var(--color-or)] bg-[var(--color-or)]/5 px-5 py-4 text-sm text-[var(--color-ivoire-soft)]"
            style={{ "--i": 4 }}
            role="status"
          >
            <span className="micro-tight block mb-1 text-[var(--color-or-pale)]">
              {t("recognize.disabled.eyebrow", { default: "Indisponible" })}
            </span>
            {t("recognize.disabled.body", {
              default:
                "La recherche par photo n'est pas activée sur cette instance. Tu peux toujours ajouter une figurine à la main.",
            })}
            <Link
              to="/figures/new"
              className="block mt-3 text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors uppercase tracking-[0.2em] text-[11px]"
            >
              ↳ {t("recognize.manual", { default: "Saisie manuelle" })}
            </Link>
          </div>
        ) : (
          <>
            {/* ─── Capture affordance ─── */}
            <section className="reveal" style={{ "--i": 4 }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="group w-full border border-[var(--color-or)]/30 bg-[var(--color-noir)]/40 hover:border-[var(--color-or)]/60 transition-colors p-8 md:p-12 flex flex-col items-center text-center disabled:opacity-60"
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="w-40 h-40 object-cover border border-[var(--color-or)]/25 mb-5"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="ja text-5xl text-[var(--color-or)] mb-4 group-hover:scale-105 transition-transform"
                  >
                    視
                  </span>
                )}
                <span className="display text-xl text-[var(--color-ivoire)]">
                  {previewUrl
                    ? t("recognize.retake", { default: "Reprendre une photo" })
                    : t("recognize.capture", { default: "Photographier la figurine" })}
                </span>
                <span className="micro-tight mt-2 opacity-80">
                  {t("recognize.capture_hint", {
                    default: "Appareil photo ou galerie — sur ton appareil uniquement",
                  })}
                </span>
              </button>
              {!hasWebGPU() && !busy && results == null ? (
                <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/55">
                  {t("recognize.wasm_hint", {
                    default: "Sans accélération GPU : la première analyse peut prendre quelques secondes.",
                  })}
                </p>
              ) : null}
            </section>

            {/* ─── Progress ─── */}
            {busy ? (
              <div className="mt-6 flex items-center gap-3 text-sm text-[var(--color-or-pale)]">
                <span aria-hidden className="ja animate-pulse">輪</span>
                <span>
                  {phase === "preparing"
                    ? t("recognize.preparing", {
                        pct: progress,
                        default: `Préparation du modèle… ${progress}%`,
                      })
                    : t("recognize.analysing", { default: "Analyse de l'image…" })}
                </span>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-4 text-sm text-[var(--color-laque-bright)]">
                {error}
              </p>
            ) : null}

            {/* ─── Results ─── */}
            {results != null && !busy ? (
              <>
                {results.length === 0 ? (
                <div className="mt-10 text-center">
                  <p className="ja text-5xl text-[var(--color-or)]/30 leading-none mb-3">無</p>
                  <p className="text-[var(--color-ivoire-soft)]">
                    {t("recognize.empty", {
                      default: "Aucune correspondance au catalogue.",
                    })}
                  </p>
                  <Link
                    to="/figures/new"
                    className="inline-block mt-4 text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors uppercase tracking-[0.2em] text-[11px]"
                  >
                    ↳ {t("recognize.manual", { default: "Saisie manuelle" })}
                  </Link>
                </div>
              ) : (
                <section className="mt-10">
                  <p className="micro mb-5 flex items-center gap-2">
                    <span aria-hidden className="ja not-italic text-[var(--color-or)]">候</span>
                    {t("recognize.candidates", {
                      n: results.length,
                      default: "Candidats — choisis la bonne",
                    })}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                    {results.map(({ figure: f, distance }) => {
                      const sim = Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
                      return (
                        <FigureCard
                          key={f.id}
                          figureId={f.id}
                          href={`/figures/${f.id}`}
                          name={f.name}
                          type={f.figure_type}
                          manufacturer={f.manufacturer_name ?? null}
                          imageUrl={resolveFigureCover(f)}
                          scale={f.scale}
                          versionName={f.version_name}
                          blurImage={f.is_nsfw && nsfwBlur}
                          badge={{ label: `${sim}%`, tone: "preorder" }}
                        />
                      );
                    })}
                  </div>
                  <Link
                    to="/figures/new"
                    className="inline-block mt-6 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)] transition-colors uppercase tracking-[0.2em] text-[11px]"
                  >
                    {t("recognize.none_match", { default: "Aucune ne correspond ? Saisir à la main" })}
                  </Link>
                </section>
                )}

                {/* ── External (off-device) fallback — opt-in; the photo is
                       sent to Google Vision only on an explicit tap ── */}
                {status?.external_enabled ? (
                  <section className="mt-12 pt-8 border-t border-[var(--color-or)]/12">
                    {externalHints == null ? (
                      <div className="text-center">
                        <p className="micro mb-3 flex items-center justify-center gap-2 text-[var(--color-or-pale)]">
                          <span aria-hidden className="ja not-italic text-[var(--color-or)]">網</span>
                          {t("recognize.external.eyebrow", { default: "Pistes externes" })}
                        </p>
                        <button
                          type="button"
                          onClick={runExternalSearch}
                          disabled={externalBusy || !capturedFile}
                          className="inline-flex items-center gap-2.5 border border-[var(--color-or)]/35 hover:border-[var(--color-or)]/70 bg-[var(--color-noir)]/40 px-6 py-3 text-[var(--color-ivoire)] transition-colors disabled:opacity-50"
                        >
                          {externalBusy ? (
                            <>
                              <span aria-hidden className="ja animate-pulse text-[var(--color-or)]">網</span>
                              {t("recognize.external.searching", { default: "Recherche sur le web…" })}
                            </>
                          ) : (
                            t("recognize.external.cta", { default: "Chercher sur le web" })
                          )}
                        </button>
                        <p className="mt-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/55">
                          {t("recognize.external.cta_note", {
                            default: "Ta photo sera envoyée à Google (Vision) pour cette recherche.",
                          })}
                        </p>
                        {externalError ? (
                          <p role="alert" className="mt-3 text-sm text-[var(--color-laque-bright)]">
                            {externalError}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div>
                        <p className="micro mb-2 flex items-center gap-2 text-[var(--color-or-pale)]">
                          <span aria-hidden className="ja not-italic text-[var(--color-or)]">網</span>
                          {t("recognize.external.eyebrow", { default: "Pistes externes" })}
                        </p>
                        <h2 className="display text-2xl text-[var(--color-ivoire)] leading-tight">
                          <AccentTitle text={t("recognize.external.title", { default: "Indices du web" })} />
                        </h2>
                        <p className="text-sm text-[var(--color-ivoire-soft)] mt-2 max-w-xl">
                          {t("recognize.external.intro", {
                            default:
                              "Ces résultats viennent de Google et ne sont pas dans ton catalogue — utilise-les pour identifier la pièce, puis ajoute-la à la main.",
                          })}
                        </p>

                        {!externalHints.best_guess &&
                        !externalHints.entities?.length &&
                        !externalHints.pages?.length &&
                        !externalHints.similar_images?.length ? (
                          <p className="mt-6 text-[var(--color-ivoire-soft)]">
                            {t("recognize.external.empty", {
                              default: "Aucune piste trouvée sur le web non plus.",
                            })}
                          </p>
                        ) : (
                          <div className="mt-6 space-y-8">
                            {externalHints.best_guess ? (
                              <div>
                                <p className="micro-tight text-[var(--color-or-pale)] mb-1">
                                  {t("recognize.external.best_guess", { default: "Meilleure hypothèse" })}
                                </p>
                                <p className="display-italic text-[var(--color-or)] text-lg">
                                  {externalHints.best_guess}
                                </p>
                                <Link
                                  to={`/figures/new?name=${encodeURIComponent(externalHints.best_guess)}`}
                                  className="inline-block mt-2 text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors uppercase tracking-[0.2em] text-[11px]"
                                >
                                  ↳ {t("recognize.external.add_with_guess", { default: "Saisir à la main avec ce nom" })}
                                </Link>
                              </div>
                            ) : null}

                            {externalHints.entities?.length ? (
                              <div>
                                <p className="micro-tight text-[var(--color-or-pale)] mb-2.5">
                                  {t("recognize.external.entities", { default: "Termes reconnus" })}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {externalHints.entities.map((e) => (
                                    <Link
                                      key={e}
                                      to={`/figures/new?name=${encodeURIComponent(e)}`}
                                      className="px-3 py-1.5 border border-[var(--color-or)]/25 hover:border-[var(--color-or)]/60 text-[var(--color-ivoire-soft)] hover:text-[var(--color-ivoire)] text-sm transition-colors"
                                    >
                                      {e}
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {externalHints.similar_images?.length ? (
                              <div>
                                <p className="micro-tight text-[var(--color-or-pale)] mb-2.5">
                                  {t("recognize.external.similar", { default: "Images visuellement proches" })}
                                </p>
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                  {externalHints.similar_images.map((u) => (
                                    <a
                                      key={u}
                                      href={u}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block aspect-square overflow-hidden border border-[var(--color-or)]/20 hover:border-[var(--color-or)]/55 transition-colors"
                                    >
                                      <img
                                        src={u}
                                        alt=""
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        className="w-full h-full object-cover"
                                      />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {externalHints.pages?.length ? (
                              <div>
                                <p className="micro-tight text-[var(--color-or-pale)] mb-2.5">
                                  {t("recognize.external.pages", { default: "Pages où cette image apparaît" })}
                                </p>
                                <ul className="space-y-2">
                                  {externalHints.pages.map((p) => (
                                    <li key={p.url}>
                                      <a
                                        href={p.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex items-baseline gap-2 text-sm text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)] transition-colors"
                                      >
                                        <span aria-hidden className="text-[var(--color-or)]/50 group-hover:text-[var(--color-or)]">↗</span>
                                        <span className="truncate">{p.title || hostnameOf(p.url)}</span>
                                        {p.title ? (
                                          <span className="text-[var(--color-ivoire-soft)]/40 text-xs shrink-0">
                                            {hostnameOf(p.url)}
                                          </span>
                                        ) : null}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </main>
    </AppShell>
  );
}
