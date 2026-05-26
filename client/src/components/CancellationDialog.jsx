import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import {
  useArchiveOwnedItem,
  useRemoveOwnedItem,
  useUpdatePreorder,
} from "../hooks/useCollection.js";
import Button from "./Button.jsx";
import FormField from "./FormField.jsx";

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
 * Props:
 *   preorder   : the preorder row to cancel
 *   ownedId    : the linked owned_item id (may be null for legacy /
 *                manually-created preorders without an owned link)
 *   onClose    : called when the dialog finishes or the user cancels
 */
export default function CancellationDialog({ preorder, ownedId, onClose }) {
  const t = useT();
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
      await archive.mutateAsync(ownedId);
      onClose?.();
    } catch (err) {
      setError(err?.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  // Render through a portal to <body>. The preorder card's hover state
  // applies a transform (and the surrounding `.reveal` animation has a
  // `translateY` keyframe), which establishes a new containing block —
  // `position: fixed` then refers to THAT ancestor instead of the viewport
  // and the modal renders clipped INSIDE the card. Portaling escapes the
  // entire stacking-context chain, same trick the Lightbox uses.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal
      onClick={() => (busy ? null : onClose?.())}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--color-noir-soft)] border border-[var(--color-laque-bright)]/60 px-6 py-5"
        style={{
          boxShadow:
            "0 50px 90px -40px rgba(0,0,0,0.95), 0 12px 28px -8px rgba(0,0,0,0.6), inset 0 1px 0 oklch(0.65 0.18 25 / 0.18)",
        }}
      >
        <header className="mb-5">
          <p className="micro text-[var(--color-laque-bright)]">
            {t("cancel.eyebrow")}
          </p>
          <h2 className="display text-xl text-[var(--color-ivoire)] mt-1">
            {step === "refund"
              ? t("cancel.refund.title")
              : t("cancel.fate.title")}
          </h2>
        </header>

        {step === "refund" ? (
          <form onSubmit={submitRefund} className="space-y-4">
            {deposit > 0 ? (
              <>
                <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
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
                        ? "border-[var(--color-laque-bright)] bg-[var(--color-laque-bright)]/15 text-[var(--color-laque-bright)]"
                        : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-laque-bright)]/60"
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
                        ? "border-[var(--color-or)] bg-[var(--color-or)]/15 text-[var(--color-or)]"
                        : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/60"
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
              <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
                {t("cancel.refund.no_deposit")}
              </p>
            )}

            {error ? (
              <p
                role="alert"
                className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
              >
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-or)]/15">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={busy}
              >
                {t("editor.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {t("cancel.refund.confirm")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
              {t("cancel.fate.body")}
            </p>
            {error ? (
              <p
                role="alert"
                className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-or)]/15">
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
                variant="primary"
                onClick={onDelete}
                loading={busy}
                className="!bg-[var(--color-laque-bright)] hover:!bg-[var(--color-laque)] !text-[var(--color-ivoire)]"
              >
                {t("cancel.fate.delete")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function parseRefund(s) {
  if (s == null || s === "") return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
