import { useT } from "../i18n/index.jsx";
import { usePatchFigure } from "../hooks/useAdmin.js";
import { mapApiError } from "../lib/errorMap.js";
import Modal from "./ui/Modal.jsx";
import FigureForm from "./FigureForm.jsx";

/**
 * Edit-figure modal. Shares its body with AddFigurePage — same FigureForm
 * component, same input types, same lookups. Now composes the shared <Modal>
 * (focus-trap, Esc, scroll-lock, scrim) instead of hand-rolling them; the
 * editorial header (subtitle + name) rides in the scroll area.
 *
 * Public API is unchanged (FigureDetailPage + AdminFiguresPage depend on it):
 * { figure, onClose, onSaved }.
 */
export default function FigureEditDialog({ figure, onClose, onSaved }) {
  const t = useT();
  const patch = usePatchFigure();

  const submit = async (payload) => {
    // Only include fields that meaningfully differ from the original. Empty
    // strings already became `undefined` in the form's serialiser; here we
    // additionally strip values equal to the original so PATCH stays minimal
    // and the activity feed only logs real changes.
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

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t("figure.edit.title")}
      description={t("figure.edit.subtitle")}
    >
      <p className="display-italic text-sm text-[var(--color-or-pale)]/70 -mt-1 mb-5 truncate">
        {figure.name}
        {figure.version_name ? <span className="not-italic"> · {figure.version_name}</span> : null}
      </p>
      <FigureForm
        mode="edit"
        initial={figure}
        onSubmit={submit}
        onCancel={onClose}
        busy={patch.isPending}
        errorMessage={errorMessage}
      />
    </Modal>
  );
}

/** Strip fields whose value already matches the existing figure. Treats null /
 *  undefined / "" as equivalent so a "blank string" isn't sent when the
 *  original was null. */
function diffPayload(next, prev) {
  const out = {};
  const norm = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (Array.isArray(v)) return v.length ? v.slice().sort().join("") : null;
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
