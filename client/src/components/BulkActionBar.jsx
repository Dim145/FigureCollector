import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

/**
 * Square gold-tick selection box used in the admin table header (select-all)
 * and each row. A real <button role=checkbox> so it's keyboard-operable.
 * Pass `indeterminate` for the header "some-but-not-all" state.
 */
export function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled = false,
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`adm-cbx ${checked || indeterminate ? "is-on" : ""}`}
    >
      <span aria-hidden>{checked ? "✓" : indeterminate ? "–" : ""}</span>
    </button>
  );
}

/**
 * Lot 6 — floating bulk-action toolbar shared by the admin tables.
 *
 * Appears (sticky, gold-tinted) only when ≥1 row is selected. Shows the
 * selected count and a danger "delete selection" button that routes through
 * the shared ConfirmDialog before firing `onDelete(ids)`. On success it
 * clears the selection and surfaces the server's `{ deleted, skipped }`
 * result inline for a beat.
 *
 * Props
 *   selectedIds  : array of selected row ids
 *   onClear      : () => void                 — deselect everything
 *   onDelete     : (ids) => Promise<{deleted,skipped}>  — the bulk mutation
 *   confirmBody  : ReactNode                  — body copy for the confirm dialog
 *   busy         : boolean                    — mutation in flight
 */
export default function BulkActionBar({
  selectedIds,
  onClear,
  onDelete,
  confirmBody,
  busy = false,
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const count = selectedIds.length;

  if (count === 0 && !result) return null;

  const doDelete = async () => {
    const res = await onDelete(selectedIds);
    setConfirming(false);
    setResult(res ?? null);
    onClear();
  };

  return (
    <>
      <div className="adm-bulk-bar" role="region" aria-label={t("admin.bulk.toolbar")}>
        <span className="adm-bulk-count">
          {result && count === 0 ? (
            t("admin.bulk.result", {
              deleted: result.deleted ?? 0,
              skipped: result.skipped ?? 0,
            })
          ) : (
            <>
              <b>{count}</b> {t("admin.bulk.selected", { n: count })}
            </>
          )}
        </span>
        <span className="adm-bulk-spacer" />
        {count > 0 ? (
          <>
            <button
              type="button"
              className="adm-bulk-act"
              onClick={onClear}
              disabled={busy}
            >
              {t("admin.bulk.clear")}
            </button>
            <button
              type="button"
              className="adm-bulk-act is-danger"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              {t("admin.bulk.delete")}
            </button>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        title={t("admin.bulk.confirm.title", { n: count })}
        body={confirmBody ?? t("admin.bulk.confirm.body", { n: count })}
        confirmLabel={t("admin.bulk.delete")}
        onConfirm={doDelete}
        onCancel={() => setConfirming(false)}
        destructive
        busy={busy}
      />
    </>
  );
}
