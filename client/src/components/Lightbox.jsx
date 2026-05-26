import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useT } from "../i18n/index.jsx";

/**
 * Full-bleed image viewer used by both the figure hero and the catalog
 * photo grid. Lazy & focus-trapped — close on Esc / backdrop click,
 * arrows left/right (button + keyboard) to navigate.
 *
 * Props
 *   open         : boolean
 *   slides       : array of `{ src, alt? }` — minimum shape
 *   index        : current slide index
 *   onChange     : (newIndex) => void
 *   onClose      : () => void
 *
 * The component owns no state — `index` + `open` come from the parent so
 * the caller controls the lifecycle and the keyboard/arrow keys still
 * work consistently across the hero + the grid lightboxes.
 */
export default function Lightbox({ open, slides, index, onChange, onClose }) {
  const t = useT();
  const cardRef = useRef(null);
  useFocusTrap(cardRef, { active: open, onClose });

  // Arrow-key navigation — wired on the dialog itself so the focus trap's
  // own keydown handler still gets Tab + Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onChange((index - 1 + slides.length) % slides.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onChange((index + 1) % slides.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, slides.length, onChange]);

  if (!open) return null;
  const slide = slides[index];
  if (!slide) return null;

  // Portal to <body> so the modal escapes any `.reveal` /
  // transform-having ancestor — `position: fixed` is constrained by the
  // nearest ancestor with `transform` (the figure-hero column's
  // `.reveal` keyframe sets `translateY`), so without the portal the
  // backdrop would only cover the hero column, not the viewport.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("photos.view")}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/95 backdrop-blur-sm"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-[92vw] max-h-[92vh] focus:outline-none"
      >
        <img
          src={slide.src}
          alt={slide.alt ?? ""}
          decoding="async"
          className="max-w-[92vw] max-h-[88vh] object-contain border border-[var(--color-or)]/30"
        />

        {/* Position counter — tiny, bottom-center, helpful when there are
            many slides. */}
        {slides.length > 1 ? (
          <p
            aria-hidden
            className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] bg-[var(--color-noir)]/70 border border-[var(--color-or)]/30"
          >
            {index + 1} / {slides.length}
          </p>
        ) : null}
      </div>

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("editor.cancel")}
        className="tap-target absolute top-4 right-4 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-3xl leading-none transition-colors"
      >
        ×
      </button>

      {/* Prev / next — only when multiple slides */}
      {slides.length > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange((index - 1 + slides.length) % slides.length);
            }}
            aria-label={t("photos.prev")}
            className="tap-target absolute left-4 md:left-8 top-1/2 -translate-y-1/2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-4xl transition-colors"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange((index + 1) % slides.length);
            }}
            aria-label={t("photos.next")}
            className="tap-target absolute right-4 md:right-8 top-1/2 -translate-y-1/2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-4xl transition-colors"
          >
            ›
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
