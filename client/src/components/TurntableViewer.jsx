import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";

/**
 * Drag-to-rotate viewer for a 360° turntable scan.
 *
 * Frames flow in three phases:
 *   1. boot — a bounded-concurrency pool preloads every frame (with
 *      per-frame retry + backoff). The visible <img> tags don't mount
 *      yet so the viewport stays on a holding state.
 *   2. ready — once every frame loaded, we mount the <img> stack and
 *      start the auto-spin.
 *   3. error — if any frame permanently failed after its retries (e.g. a
 *      persistent 429), we show an explicit error + manual retry rather
 *      than silently spinning past a blank frame.
 *
 * This kills both the "first-load flicker" and the old behaviour where a
 * rate-limited frame was counted as loaded and left a hole in the spin.
 */
export default function TurntableViewer({ scanId, frameCount, embedded = false }) {
  const t = useT();
  const containerRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const drag = useRef(null);
  // Fullscreen overlay. `embedded` instances (the ones rendered *inside*
  // the overlay) never re-open it — that's what stops the recursion.
  const [fullscreen, setFullscreen] = useState(false);

  // -- Preload phase --------------------------------------------------------
  const urls = useMemo(
    () =>
      Array.from({ length: frameCount }, (_, i) => `/api/scans/${scanId}/frames/${i}`),
    [scanId, frameCount],
  );
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(0);
  // Bumped by the manual "retry" button to re-run the preload effect from
  // scratch — the user's "retente à la prochaine tentative".
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (frameCount === 0) return undefined;
    setLoaded(0);
    setFailed(0);
    let cancelled = false;

    // Two root-cause fixes for the 429s we used to swallow:
    //  1. Bounded concurrency — firing all ~96 frame requests in one tick
    //     trips upstream rate limiters (reverse proxy / host). A small
    //     pool keeps the request rate civil.
    //  2. Retry with backoff — a transient 429 / network blip on a single
    //     frame is retried a few times (cache-busted so a cached 429 isn't
    //     replayed) instead of being silently counted as "loaded" and
    //     leaving a blank frame in the spin.
    const CONCURRENCY = 6;
    const MAX_RETRIES = 3;

    // Resolve true on success, false on permanent failure.
    const loadOne = (src) =>
      new Promise((resolve) => {
        let attempt = 0;
        const tryLoad = () => {
          if (cancelled) {
            resolve(false);
            return;
          }
          const im = new Image();
          const cleanup = () => {
            im.onload = null;
            im.onerror = null;
          };
          im.onload = () => {
            cleanup();
            if (cancelled) {
              resolve(false);
              return;
            }
            // Decode up-front so we never paint a half-decoded frame.
            if (typeof im.decode === "function") {
              im.decode().then(() => resolve(true), () => resolve(true));
            } else {
              resolve(true);
            }
          };
          im.onerror = () => {
            cleanup();
            if (cancelled) {
              resolve(false);
              return;
            }
            attempt += 1;
            if (attempt > MAX_RETRIES) {
              resolve(false);
              return;
            }
            // 400ms → 800ms → 1600ms + jitter.
            const delay = 400 * 2 ** (attempt - 1) + Math.random() * 200;
            setTimeout(tryLoad, delay);
          };
          // Cache-bust on retry so a browser-cached 429/error response
          // doesn't get replayed straight back to us.
          im.src = attempt === 0 ? src : `${src}?retry=${attempt}`;
        };
        tryLoad();
      });

    // Bounded-concurrency pool over the frame URLs.
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < urls.length) {
        const ok = await loadOne(urls[cursor++]);
        if (cancelled) return;
        if (ok) setLoaded((n) => n + 1);
        else setFailed((n) => n + 1);
      }
    };
    const pool = Array.from(
      { length: Math.min(CONCURRENCY, urls.length) },
      () => worker(),
    );
    Promise.all(pool);

    return () => {
      cancelled = true;
    };
  }, [urls, frameCount, retryNonce]);

  const ready = frameCount > 0 && loaded >= frameCount;
  // Every frame has settled (loaded or permanently failed) and at least
  // one failed — surface the error instead of spinning forever or
  // mounting a viewer with holes in the rotation.
  const settled = frameCount > 0 && loaded + failed >= frameCount;
  const hasError = settled && failed > 0;

  // -- Auto-spin (only when ready) -----------------------------------------
  const [autoSpin, setAutoSpin] = useState(true);
  useEffect(() => {
    if (!autoSpin || !ready) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % frameCount);
    }, 80);
    return () => clearInterval(id);
  }, [autoSpin, ready, frameCount]);

  // -- Fullscreen: close on Esc --------------------------------------------
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // -- Pointer drag ---------------------------------------------------------
  const onPointerDown = (e) => {
    if (!ready) return;
    setAutoSpin(false);
    drag.current = { startX: e.clientX, startFrame: current };
    containerRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current || !containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const delta = e.clientX - drag.current.startX;
    const sensitivity = frameCount / Math.max(200, width * 0.8);
    const next = Math.round(drag.current.startFrame - delta * sensitivity);
    const wrapped = ((next % frameCount) + frameCount) % frameCount;
    setCurrent(wrapped);
  };
  const onPointerUp = (e) => {
    drag.current = null;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const pct = frameCount > 0 ? Math.round((loaded / frameCount) * 100) : 0;

  const stage = (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setAutoSpin((x) => !x)}
      className={`relative bg-[var(--color-noir)] border border-[var(--color-or)]/20 select-none touch-none ${
        embedded ? "w-full h-full" : "aspect-square"
      } ${ready ? "cursor-grab active:cursor-grabbing" : "cursor-progress"}`}
      role="img"
      aria-label="360° turntable viewer"
    >
      {ready ? (
        // All frames mounted, visibility toggled — preserves decoded state
        urls.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            loading="eager"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{ visibility: i === current ? "visible" : "hidden" }}
          />
        ))
      ) : hasError ? (
        // Error state — some frames never loaded (persistent 429 / network).
        // Surface it + offer a manual retry instead of hiding the failure.
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="ja text-[var(--color-laque-bright)] text-3xl leading-none" aria-hidden>
              ✕
            </p>
            <p
              role="alert"
              className="mt-3 text-sm text-[var(--color-ivoire-soft)] max-w-[28ch]"
            >
              {t("turntable.viewer.load_error", { failed, total: frameCount })}
            </p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5 transition-colors"
            >
              ↻ {t("turntable.viewer.retry")}
            </button>
          </div>
        </div>
      ) : (
        // Holding state — gold ring + percentage so the viewer never paints
        // a half-decoded frame.
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div
              aria-hidden
              className="relative mx-auto w-16 h-16 rounded-full border border-[var(--color-or)]/20"
            >
              <div
                className="absolute inset-0 rounded-full border border-transparent border-t-[var(--color-or)]"
                style={{ animation: "spin 1.2s linear infinite" }}
              />
            </div>
            <p className="micro mt-4 font-mono">
              {loaded}/{frameCount}
            </p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] mt-1">
              {pct}%
            </p>
          </div>
        </div>
      )}

      {/* Progress ring at the bottom */}
      <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
        <div className="h-px bg-[var(--color-or)]/15">
          <div
            className="h-px bg-[var(--color-or)] transition-[width] duration-75"
            style={{
              width: ready
                ? `${((current + 1) / frameCount) * 100}%`
                : `${pct}%`,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-mono tracking-wider text-[var(--color-or-pale)] opacity-80">
          <span>
            {ready ? `${current + 1}/${frameCount}` : `${loaded}/${frameCount}`}
          </span>
          <span>{ready ? (autoSpin ? "↻ auto" : "✋ drag") : "⌛ load"}</span>
        </div>
      </div>

      {/* Fullscreen toggle — only on the inline instance (not the one
          already rendered inside the overlay), and only once frames are
          ready so it doesn't overlap the loading ring. */}
      {!embedded && ready ? (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title={t("turntable.viewer.fullscreen")}
          aria-label={t("turntable.viewer.fullscreen")}
          className="absolute top-2 right-2 z-10 w-9 h-9 grid place-items-center bg-[var(--color-noir)]/70 border border-[var(--color-or)]/40 text-[var(--color-or-pale)] hover:text-[var(--color-or)] hover:border-[var(--color-or)] transition-colors"
        >
          ⛶
        </button>
      ) : null}
    </div>
  );

  if (embedded) return stage;

  return (
    <>
      {stage}
      {fullscreen && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("turntable.viewer.fullscreen")}
              onClick={() => setFullscreen(false)}
              className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/95 backdrop-blur-sm p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                // Big square capped to the smaller viewport side so it
                // stays fully visible on both portrait phones and wide
                // desktops, with the same gold frame as the hero.
                style={{ width: "min(88vmin, 960px)", height: "min(88vmin, 960px)" }}
              >
                <TurntableViewer
                  scanId={scanId}
                  frameCount={frameCount}
                  embedded
                />
              </div>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label={t("editor.cancel")}
                className="tap-target absolute top-4 right-4 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-3xl leading-none transition-colors"
              >
                ×
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
