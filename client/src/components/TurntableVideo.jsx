import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

// Server rejects frames > 2048 px per side. Keep a safety margin and downscale
// the *longest* side (so portrait 4K videos round-trip too — clamping width
// only would leave the height above the server limit).
const MAX_FRAME_DIM = 1920;

/**
 * Video-to-frames extraction. The user picks a video file (or records one
 * with the system camera). We then sample N evenly-spaced frames via
 * HTMLVideoElement seek + canvas. Everything stays in the browser.
 *
 * Two subtleties browsers care about:
 *  - `loadedmetadata` only gives us dimensions; we need `loadeddata` (first
 *    frame buffered) before seeks paint anything.
 *  - A `seeked` event fires before the new frame is composited. We use
 *    `requestVideoFrameCallback` (well-supported since 2022) to await the
 *    actual paint — otherwise canvas captures the *previous* frame, or
 *    black, on iOS Safari and some Chromium builds.
 */
export default function TurntableVideo({ onComplete }) {
  const t = useT();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previews, setPreviews] = useState([]);

  // Revoke every preview blob URL at unmount — the user can navigate
  // away mid-extraction and otherwise the browser holds dozens of large
  // WebP/JPEG blobs in memory until GC eventually kicks in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), []);
  const [frames, setFrames] = useState([]);
  const [target, setTarget] = useState(24);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    cleanup();
    setFile(f);
    setError(null);
  };

  const cleanup = () => {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setPreviews([]);
    setFrames([]);
  };

  const extract = async () => {
    setBusy(true);
    setProgress(0);
    setError(null);
    cleanup();

    let objectUrl = null;
    try {
      const video = videoRef.current;
      objectUrl = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      // Belt-and-braces: `URL.createObjectURL` only ever returns `blob:`
      // URLs, but the explicit prefix check (a) is a meaningful guard if
      // future code ever feeds a different source into `objectUrl`, and
      // (b) acts as a sanitizer that CodeQL's `js/xss-through-dom` rule
      // recognises — without it the rule treats `file` (from the picker)
      // as DOM-sourced and flags this assignment.
      if (!objectUrl.startsWith("blob:")) {
        throw new Error("createObjectURL did not return a blob URL");
      }
      video.src = objectUrl;

      // `loadeddata` = first frame buffered. `loadedmetadata` alone leaves
      // the decoder cold and seeks paint black.
      await new Promise((res, rej) => {
        video.onloadeddata = res;
        video.onerror = () => rej(new Error("could not decode video"));
      });

      // Prime the decoder. Mobile Safari + some Chromium builds won't paint
      // seek targets to a `<video>` that's never been played, so briefly
      // play (muted, so autoplay is allowed) and immediately pause.
      try {
        await video.play();
        video.pause();
      } catch {
        /* paused-decode worked on this browser */
      }

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("invalid video duration");
      }

      // Downscale the longest side to MAX_FRAME_DIM. Preserves aspect ratio
      // *and* keeps both dimensions below the server's 2048 px limit.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) throw new Error("video has no visible track");
      const scale = Math.min(1, MAX_FRAME_DIM / Math.max(vw, vh));
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);

      const canvas = canvasRef.current;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");

      const blobs = [];
      const urls = [];
      // Skip the first and last 1% (often blurry hand-on/off frames).
      const start = duration * 0.01;
      const end = duration * 0.99;
      const step = (end - start) / target;
      for (let i = 0; i < target; i++) {
        const seekTo = start + step * i;

        // The painted-frame signal MUST be registered *before* mutating
        // currentTime: the seek will produce a new compositor frame and
        // fire rVFC, but if we register only after `seeked` the paint has
        // already happened on a paused video and rVFC will never fire.
        await new Promise((res) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            res();
          };

          if (typeof video.requestVideoFrameCallback === "function") {
            video.requestVideoFrameCallback(() => finish());
          } else {
            // Fallback: seeked + two rAFs to let the compositor paint.
            video.addEventListener(
              "seeked",
              () => requestAnimationFrame(() => requestAnimationFrame(finish)),
              { once: true },
            );
          }
          // Safety net — if neither signal fires (rare browser quirk on
          // paused videos), don't deadlock the whole extraction.
          setTimeout(finish, 1200);

          video.currentTime = seekTo;
        });

        ctx.drawImage(video, 0, 0, w, h);
        const blob = await new Promise((res) =>
          canvas.toBlob(res, "image/webp", 0.85),
        );
        if (blob) {
          blobs.push(blob);
          urls.push(URL.createObjectURL(blob));
        }
        setProgress(Math.round(((i + 1) / target) * 100));
      }

      setFrames(blobs);
      setPreviews(urls);
    } catch (e) {
      setError(e?.message ?? "extraction failed");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      {/*
        Keep the <video> in the render tree but visually offscreen. Tailwind
        `hidden` = display:none, which on Chromium and WebKit lets the browser
        skip composition entirely — drawImage paints black and
        requestVideoFrameCallback never fires. Position-absolute + opacity
        keeps the decoder live.
      */}
      <video
        ref={videoRef}
        aria-hidden
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <canvas ref={canvasRef} className="hidden" />

      {!file ? (
        <label className="block">
          <input
            type="file"
            accept="video/*"
            capture="environment"
            onChange={onFile}
            className="hidden"
          />
          <div className="border-2 border-dashed border-[var(--color-or)]/30 hover:border-[var(--color-or)]/60 transition-colors p-12 text-center cursor-pointer">
            <p className="display text-2xl text-[var(--color-ivoire)]">
              {t("turntable.video.cta")}
            </p>
            <p className="micro mt-3">{t("turntable.video.hint")}</p>
          </div>
        </label>
      ) : (
        <div className="space-y-6">
          <p className="micro">
            {t("turntable.video.picked", { name: file.name })}
          </p>

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]">
            <span>{t("turntable.target")}</span>
            {[12, 24, 36, 48].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTarget(n)}
                className={`px-2 py-0.5 transition-colors ${
                  target === n
                    ? "text-[var(--color-or)] border-b border-[var(--color-or)]"
                    : "hover:text-[var(--color-or-pale)]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={extract}
            disabled={busy}
            className="px-5 py-3 border border-[var(--color-or)] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 text-[11px] uppercase tracking-[0.18em] disabled:opacity-40"
          >
            {busy
              ? t("turntable.video.extracting", { p: progress })
              : t("turntable.video.extract")}
          </button>

          {error ? (
            <p role="alert" className="text-sm text-[var(--color-laque-bright)]">
              {error}
            </p>
          ) : null}

          {previews.length > 0 ? (
            <>
              <ul className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {previews.map((url, i) => (
                  <li
                    key={i}
                    className="aspect-square bg-[var(--color-noir)] border border-[var(--color-or)]/15 overflow-hidden"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={frames.length < 6}
                  onClick={() => onComplete(frames)}
                  className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.18em] disabled:opacity-40"
                >
                  {t("turntable.save")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
