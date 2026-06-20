import { useState } from "react";
import Button from "../../components/Button.jsx";
import CancellationDialog from "../../components/CancellationDialog.jsx";
import FormField from "../../components/FormField.jsx";
import Select from "../../components/Select.jsx";
import StoreAutocomplete from "../../components/StoreAutocomplete.jsx";
import TrackingChip from "../../components/TrackingChip.jsx";
import {
  usePreorderHistory,
  useUpdatePreorder,
  useUpdatePreorderHistory,
} from "../../hooks/useCollection.js";
import { STATUS_OPTIONS } from "./preorderConstants.js";

/**
 * Inline edit form for a single preorder. Lives inside the entry so the user
 * never loses their place. Quick-status chips jump to shipped/received without
 * filling the whole form; cancellation routes through CancellationDialog so we
 * never silently flip a preorder to `cancelled` (the dialog prompts for the
 * refund + the owned_item fate).
 */
export default function PreorderEditForm({ preorder: p, onClose, t }) {
  const [form, setForm] = useState(() => ({
    status: p.status ?? "preordered",
    // Seed the autocomplete from the joined store_name. The save flow sends a
    // free-text `store` string the server resolves via upsert_store(), so
    // swapping the name on save still works.
    store: p.store_name ?? "",
    order_ref: p.order_ref ?? "",
    tracking_url: p.tracking_url ?? "",
    release_date: p.release_date_current ?? "",
    deposit_amount: p.deposit_amount != null ? String(p.deposit_amount) : "",
    estimated_delivery_days:
      p.estimated_delivery_days != null ? String(p.estimated_delivery_days) : "",
    note: "",
  }));
  const [cancelOpen, setCancelOpen] = useState(false);
  const update = useUpdatePreorder();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const quickStatus = (next) => update.mutate({ id: p.id, patch: { status: next } });

  const onSubmit = async (e) => {
    e.preventDefault();
    const nz = (s) => (typeof s === "string" && s.trim() !== "" ? s.trim() : null);
    const num = (s) => {
      if (!s || s === "") return null;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const payload = {
      status: form.status,
      store: nz(form.store),
      order_ref: nz(form.order_ref),
      tracking_url: nz(form.tracking_url),
      release_date: form.release_date || null,
      release_date_note: nz(form.note),
      deposit_amount: num(form.deposit_amount),
      estimated_delivery_days: form.estimated_delivery_days
        ? Number.parseInt(form.estimated_delivery_days, 10) || null
        : null,
    };
    await update.mutateAsync({ id: p.id, patch: payload });
    onClose();
  };

  return (
    <form onSubmit={onSubmit} className="horarium-entry-form space-y-5">
      {/* Quick status transitions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro-tight mr-2">{t("preorders.quick.title")}</span>
        <QuickStatusBtn
          label={t("status.shipped")}
          active={form.status === "shipped"}
          onClick={() => {
            set("status")("shipped");
            quickStatus("shipped");
          }}
        />
        <QuickStatusBtn
          label={t("status.received")}
          active={form.status === "received"}
          tone="gold"
          onClick={() => {
            set("status")("received");
            quickStatus("received");
          }}
        />
        <QuickStatusBtn
          label={t("status.cancelled")}
          active={form.status === "cancelled"}
          tone="laque"
          onClick={() => setCancelOpen(true)}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={t("preorders.field.status")}
          value={form.status}
          onChange={set("status")}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: t(`status.${s}`) }))}
        />
        <FormField
          label={t("preorders.field.release_date")}
          type="date"
          value={form.release_date}
          onChange={set("release_date")}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <StoreAutocomplete
          label={t("preorders.field.store")}
          value={form.store}
          onChange={set("store")}
          placeholder={t("preorders.field.store_ph")}
        />
        <FormField
          label={t("preorders.field.order_ref")}
          value={form.order_ref}
          onChange={set("order_ref")}
          placeholder={t("preorders.field.order_ref_ph")}
        />
      </div>

      <div>
        <FormField
          label={t("preorders.field.tracking_url")}
          type="url"
          value={form.tracking_url}
          onChange={set("tracking_url")}
          placeholder={t("preorders.field.tracking_url_ph")}
          hint={t("preorders.field.tracking_url_hint")}
        />
        {form.tracking_url ? (
          <div className="mt-3">
            <TrackingChip url={form.tracking_url} size="compact" />
          </div>
        ) : null}
      </div>

      <FormField
        label={t("preorders.field.deposit")}
        type="number"
        value={form.deposit_amount}
        onChange={set("deposit_amount")}
        placeholder={t("preorders.field.deposit_ph")}
        hint={t("preorders.field.deposit_hint")}
      />

      {/* Delivery ETA — only meaningful from `shipped` onward, but editable in
       *  all states so the user can pre-fill a carrier ETA before our status
       *  flip catches up. */}
      <FormField
        label={t("preorders.field.delivery_days")}
        type="number"
        value={form.estimated_delivery_days}
        onChange={set("estimated_delivery_days")}
        placeholder={t("preorders.field.delivery_days_ph")}
        hint={t("preorders.field.delivery_days_hint")}
      />

      <FormField
        label={t("preorders.bump_note")}
        value={form.note}
        onChange={set("note")}
        placeholder={t("preorders.bump_note_ph")}
        hint={t("preorders.bump_note_hint")}
      />

      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {update.error?.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="ghost" type="button" onClick={onClose} disabled={update.isPending}>
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          {t("preorders.save")}
        </Button>
      </div>

      {cancelOpen ? (
        <CancellationDialog
          preorder={p}
          ownedId={p.owned_item_id ?? null}
          onClose={() => {
            setCancelOpen(false);
            // The mutation already invalidates ["preorders"] + ["owned"], so
            // the parent re-renders with the cancelled row resolved — just
            // dismiss our local UI.
            onClose();
          }}
        />
      ) : null}
    </form>
  );
}

function QuickStatusBtn({ label, active, onClick, tone = "default" }) {
  const toneClass =
    tone === "gold"
      ? active
        ? "bg-[var(--color-or)] text-[var(--color-noir)] border-[var(--color-or)]"
        : "border-[var(--color-or)]/40 text-[var(--color-or)] hover:border-[var(--color-or)] hover:bg-[var(--color-or)]/10"
      : tone === "laque"
        ? active
          ? "bg-[var(--color-laque)] text-[var(--color-ivoire)] border-[var(--color-laque)]"
          : "border-[var(--color-laque-bright)]/40 text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)] hover:bg-[var(--color-laque)]/10"
        : active
          ? "bg-[var(--color-or)]/15 text-[var(--color-or)] border-[var(--color-or)]"
          : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/70 hover:text-[var(--color-or-pale)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 min-h-[44px] text-[10px] uppercase tracking-[0.22em] border transition-colors ${toneClass}`}
    >
      {label}
    </button>
  );
}

// =============================================================================
// Slip-history accordion (collapsed by default; mounted only when opened)
// =============================================================================

export function PreorderHistory({ id, t }) {
  const history = usePreorderHistory(id);
  if (history.isLoading) return null;
  if (!history.data?.length) return null;

  return (
    <section className="horarium-history">
      <header className="horarium-history-heading">
        <span className="horarium-history-heading-kanji" aria-hidden>
          記
        </span>
        <h3 className="horarium-history-heading-label">{t("preorders.history_title")}</h3>
      </header>
      <ol className="horarium-history-list">
        {history.data.map((entry) => (
          <HistoryEntry key={entry.id} preorderId={id} entry={entry} t={t} />
        ))}
      </ol>
    </section>
  );
}

/** Single slip-history line. The reason is the focal point; the date
 *  transition is a quiet mono badge. The inline edit form lets the user revise
 *  an old reason after the fact — opening it seeds `note` from the server
 *  value, so a successful save (which refetches the parent) makes the new
 *  value the source of truth with no sync gymnastics. */
function HistoryEntry({ preorderId, entry, t }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const update = useUpdatePreorderHistory();

  const openEditor = () => {
    setNote(entry.note ?? "");
    setEditing(true);
  };

  const onSave = (e) => {
    e.preventDefault();
    update.mutate(
      { preorderId, entryId: entry.id, note: note.trim() || null },
      { onSuccess: () => setEditing(false) },
    );
  };

  const hasNote = !!entry.note?.trim();

  return (
    <li className="horarium-history-item">
      <span className="horarium-history-dates">
        <span>{entry.previous_date ?? "?"}</span>
        <span className="horarium-history-arrow" aria-hidden>
          →
        </span>
        <span>{entry.new_date ?? "?"}</span>
      </span>

      {editing ? (
        <form className="horarium-history-form" onSubmit={onSave}>
          <input
            type="text"
            className="horarium-history-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("preorders.history.note_ph")}
            aria-label={t("preorders.history.note_ph")}
            autoFocus
            disabled={update.isPending}
          />
          <div className="horarium-history-form-actions">
            <button
              type="button"
              className="horarium-history-form-btn is-cancel"
              onClick={() => {
                setNote(entry.note ?? "");
                setEditing(false);
              }}
              disabled={update.isPending}
            >
              {t("preorders.history.cancel")}
            </button>
            <button
              type="submit"
              className="horarium-history-form-btn is-save"
              disabled={update.isPending}
            >
              {t("preorders.history.save_note")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className={`horarium-history-note ${hasNote ? "" : "is-empty"}`}>
            {hasNote ? entry.note : t("preorders.history.no_note")}
          </span>
          <div className="horarium-history-note-actions">
            <button type="button" className="horarium-history-edit-btn" onClick={openEditor}>
              ✎ {hasNote ? t("preorders.history.edit_existing") : t("preorders.history.edit_note")}
            </button>
          </div>
        </>
      )}
    </li>
  );
}
