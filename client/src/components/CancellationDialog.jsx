import { useId, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import {
  useArchiveOwnedItem,
  useRemoveOwnedItem,
  useUpdatePreorder,
} from "../hooks/useCollection.js";
import { Modal, Button } from "./ui/index.js";
import FormField from "./FormField.jsx";
import Select from "./Select.jsx";

/** Archive reasons, mirrored from the server's `ALLOWED_ARCHIVE_REASONS`. An
 *  empty value keeps the reason unspecified (column stays null). */
const ARCHIVE_REASONS = ["sold", "traded", "lost", "gifted", "other"];

/**
 * Two-step modal for marking a preorder as cancelled.
 *
 * Step 1 — Refund amount: the user records how much (if anything) was
 * actually paid back. Quick buttons cover the two common cases:
 *   - "Perdu" → refund = 0 (typical OrzGK / AmiAmi cancellation by user)
 *   - "Entièrement remboursé" → refund = deposit (shop-side cancellation)
 * Or they fill the field manually for partial refunds (rare but real).
 *
 * Step 2 — Owned-item fate: only shown when the refund covers the full
 * deposit (so there's nothing left to track). User picks:
 *   - Supprimer  → delete the owned_item too (cascades the preorder)
 *   - Archiver   → keep the row but mark archived_at so default
 *                  list views hide it
 *
 * When the refund is partial (< deposit), the dialog skips Step 2 and
 * archives the owned_item automatically — there's a real loss to keep
 * on record so deleting it would erase data the user might want later
 * (notably for the year-in-review "Pertes sur annulations" line).
 *
 * Composes the shared <Modal> (portal, focus-trap, Esc, scroll-lock, scrim)
 * so it no longer hand-rolls a portal + scrim. Portaling escapes the
 * preorder card's transformed containing block, same as before.
 *
 * Props:
 *   preorder   : the preorder row to cancel
 *   ownedId    : the linked owned_item id (may be null for legacy /
 *                manually-created preorders without an owned link)
 *   onClose    : called when the dialog finishes or the user cancels
 */
export default function CancellationDialog({ preorder, ownedId, onClose }) {
  const t = useT();
  const formId = useId();
  const deposit = preorder?.deposit_amount != null
    ? Number(preorder.deposit_amount)
    : 0;
  const currency = preorder?.price_currency ?? "";

  const [step, setStep] = useState("refund");
  const [refund, setRefund] = useState(
    preorder?.deposit_refund_amount != null
      ? String(preorder.deposit_refund_amount)
      : "",
  );
  // Optional archive reason captured at the "fate" step (full-refund path).
  const [archiveReason, setArchiveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const updatePreorder = useUpdatePreorder();
  const archive = useArchiveOwnedItem();
  const remove = useRemoveOwnedItem();

  const refundNum = parseRefund(refund);
  const fullyRefunded = deposit > 0 && refundNum != null && refundNum >= deposit;

  const submitRefund = async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    setError(null);
    try {
      await updatePreorder.mutateAsync({
        id: preorder.id,
        patch: {
          status: "cancelled",
          deposit_refund_amount: refundNum,
        },
      });
      // If the owned_item exists, decide its fate based on the refund.
      if (ownedId) {
        if (fullyRefunded) {
          // Ask the user whether to delete or archive.
          setStep("fate");
        } else {
          // Partial / no refund → auto-archive to preserve the loss record.
          await archive.mutateAsync(ownedId);
          onClose?.();
        }
      } else {
        onClose?.();
      }
    } catch (err) {
      setError(err?.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await remove.mutateAsync(ownedId);
      onClose?.();
    } catch (err) {
      setError(err?.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const onArchive = async () => {
    setBusy(true);
    setError(null);
    try {
      // Pass the (optional) reason; empty → bare archive, unchanged behaviour.
      await archive.mutateAsync(
        archiveReason ? { id: ownedId, reason: archiveReason } : ownedId,
      );
      onClose?.();
    } catch (err) {
      setError(err?.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const errorBlock = error ? (
    <p
      role="alert"
      className="text-sm text-[var(--danger)] border-l-2 border-[var(--danger)] pl-3 py-1"
    >
      {error}
    </p>
  ) : null;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      size="sm"
      title={
        <>
          <span className="micro block mb-1 text-[var(--danger)]">
            {t("cancel.eyebrow")}
          </span>
          {step === "refund"
            ? t("cancel.refund.title")
            : t("cancel.fate.title")}
        </>
      }
      footer={
        step === "refund" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              {t("editor.cancel")}
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={busy}>
              {t("cancel.refund.confirm")}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={onArchive}
              disabled={busy}
            >
              {t("cancel.fate.archive")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={onDelete}
              loading={busy}
            >
              {t("cancel.fate.delete")}
            </Button>
          </>
        )
      }
    >
      {step === "refund" ? (
        <form id={formId} onSubmit={submitRefund} className="space-y-4">
          {deposit > 0 ? (
            <>
              <p className="text-sm text-[var(--on-surface-muted)] leading-relaxed">
                {t("cancel.refund.body", {
                  deposit: fmtMoney(deposit),
                  currency,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRefund("0")}
                  aria-pressed={refundNum === 0}
                  className={`flex-1 px-3 py-2 text-[10px] uppercase tracking-[0.22em] border transition-colors ${
                    refundNum === 0
                      ? "border-[var(--danger)] bg-[var(--danger-surface)] text-[var(--danger)]"
                      : "border-[var(--border)] text-[var(--on-surface-muted)] hover:border-[var(--danger)]/60"
                  }`}
                >
                  {t("cancel.refund.lost")}
                </button>
                <button
                  type="button"
                  onClick={() => setRefund(String(deposit))}
                  aria-pressed={fullyRefunded}
                  className={`flex-1 px-3 py-2 text-[10px] uppercase tracking-[0.22em] border transition-colors ${
                    fullyRefunded
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--on-surface-muted)] hover:border-[var(--accent)]/60"
                  }`}
                >
                  {t("cancel.refund.full")}
                </button>
              </div>
              <FormField
                label={t("cancel.refund.field")}
                type="number"
                value={refund}
                onChange={setRefund}
                placeholder="0"
              />
            </>
          ) : (
            <p className="text-sm text-[var(--on-surface-muted)] leading-relaxed">
              {t("cancel.refund.no_deposit")}
            </p>
          )}

          {errorBlock}
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--on-surface-muted)] leading-relaxed">
            {t("cancel.fate.body")}
          </p>
          {/* Optional archive reason — only relevant when keeping the row
              (Archive). Empty stays unspecified. */}
          <Select
            label={t("cancel.fate.reason_label")}
            value={archiveReason}
            onChange={setArchiveReason}
            options={[
              { value: "", label: t("archive.reason.unset") },
              ...ARCHIVE_REASONS.map((r) => ({
                value: r,
                label: t(`archive.reason.${r}`),
              })),
            ]}
          />
          {errorBlock}
        </div>
      )}
    </Modal>
  );
}

function parseRefund(s) {
  if (s == null || s === "") return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(appLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
