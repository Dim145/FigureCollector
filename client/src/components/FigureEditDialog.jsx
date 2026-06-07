import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { usePatchFigure } from "../hooks/useAdmin.js";
import { mapApiError } from "../lib/errorMap.js";
import FigureForm from "./FigureForm.jsx";

/**
 * Edit-figure modal. Shares its body with AddFigurePage — same FigureForm
 * component, same input types, same series lookup. The wrapper is just a
 * scroll-locking backdrop, a sticky header, and a body with overflow-y so
 * tall forms remain accessible on short viewports.
 */
export default function FigureEditDialog({ figure, onClose, onSaved }) {
  const t = useT();
  const patch = usePatchFigure();
  const cardRef = useRef(null);
  // Focus trap + Esc + restore focus to the trigger on close.
  useFocusTrap(cardRef, { active: true, onClose });

  // Lock body scroll while the modal is open. Restores on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = async (payload) => {
    // Only include fields that meaningfully differ from the original. Empty
    // strings already became `undefined` in the form's serialiser; here we
    // additionally strip values that equal the original so PATCH stays
    // minimal and the activity feed only logs real changes.
    const diff = diffPayload(payload, figure);
    if (Object.keys(diff).length === 0) {
      onClose();
      return;
    }
    const updated = await patch.mutateAsync({ id: figure.id, patch: diff });
    onSaved?.(updated);
    onClose();
  };

  const errorMessage = patch.error ? mapApiError(patch.error, t) : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="figure-edit-title"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 w-[95vw] max-w-3xl max-h-[92vh] flex flex-col frame-corners focus:outline-none"
        style={{
          boxShadow:
            "0 60px 120px -50px rgba(0,0,0,0.85), inset 0 1px 0 oklch(0.92 0.03 75 / 0.06)",
        }}
      >
        {/* Sticky header */}
        <header className="shrink-0 px-7 py-5 border-b border-[var(--color-or)]/20 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro">{t("figure.edit.subtitle")}</p>
            <h2
              id="figure-edit-title"
              className="display text-2xl text-[var(--color-ivoire)] mt-1 truncate"
            >
              {t("figure.edit.title")}
            </h2>
            <p className="display-italic text-sm text-[var(--color-or-pale)]/70 mt-1 truncate">
              {figure.name}
              {figure.version_name ? (
                <span className="not-italic"> · {figure.version_name}</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("editor.cancel")}
            className="shrink-0 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-2xl leading-none transition-colors -mt-1"
          >
            ×
          </button>
        </header>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-7 py-6">
          <FigureForm
            mode="edit"
            initial={figure}
            onSubmit={submit}
            onCancel={onClose}
            busy={patch.isPending}
            errorMessage={errorMessage}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Strip fields whose value already matches the existing figure. Treats null /
 *  undefined / "" as equivalent so a "blank string" doesn't get sent when the
 *  original was null. */
function diffPayload(next, prev) {
  const out = {};
  const norm = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (Array.isArray(v)) return v.length ? v.slice().sort().join("") : null;
    return String(v);
  };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue; // form chose not to send
    const prevVal = prev?.[k];
    if (norm(v) !== norm(prevVal)) {
      out[k] = v;
    }
  }
  return out;
}
