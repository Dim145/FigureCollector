import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useUpdateOwnedItem } from "../hooks/useCollection.js";
import Button from "./Button.jsx";
import FormField from "./FormField.jsx";
import Select from "./Select.jsx";

/** Allowed condition values, mirrored from the server's allow-list. */
const CONDITION_OPTIONS = [
  "mib_sealed",
  "opened_box",
  "displayed",
  "loose",
  "damaged",
];

const CURRENCY_OPTIONS = ["JPY", "EUR", "USD", "GBP", "CHF", "CAD"];

/**
 * Inline editor for the per-user metadata on a figure that's already in the
 * collection. Surfaced on the figure detail page only when the viewer owns
 * the figure.
 *
 * The display mode shows the four most-relevant facts (condition + price +
 * store + purchase date) as museum-style key/value rows with a single
 * "✎ Éditer" button. Clicking opens the same row layout but as editable
 * inputs + a textarea for free-form notes.
 *
 * Quick-status pills at the top of the form let collectors flip between the
 * five condition values without scrolling to the select.
 *
 * @param {object} props
 * @param {object} props.owned     The owned-item row returned by /me/owned.
 */
export default function OwnedItemEditor({ owned }) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  if (!owned) return null;

  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <p className="micro">{t("owned.editor.eyebrow")}</p>
          <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
            {t("owned.editor.title")}
          </h2>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5"
          >
            ✎ {t("owned.editor.edit")}
          </button>
        ) : null}
      </header>

      {editing ? (
        <EditMode owned={owned} onClose={() => setEditing(false)} t={t} />
      ) : (
        <ReadMode owned={owned} t={t} />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Read mode

function ReadMode({ owned, t }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-1 border border-[var(--color-or)]/15 bg-[var(--color-noir)]/40 px-5 py-4">
      <Row label={t("owned.editor.field.condition")}>
        <ConditionChip code={owned.condition} t={t} />
      </Row>
      <Row label={t("owned.editor.field.purchase_date")}>
        {owned.purchase_date
          ? new Date(owned.purchase_date).toLocaleDateString()
          : "—"}
      </Row>
      <Row label={t("owned.editor.field.store")}>{owned.store ?? "—"}</Row>
      <Row label={t("owned.editor.field.price")}>
        {owned.price_amount
          ? `${owned.price_amount} ${owned.price_currency ?? ""}`.trim()
          : "—"}
      </Row>
      <Row label={t("owned.editor.field.location")}>
        {owned.location ?? "—"}
      </Row>
      <Row label={t("owned.editor.field.notes")}>
        {owned.notes ? (
          <span className="whitespace-pre-wrap text-[var(--color-ivoire)]">
            {owned.notes}
          </span>
        ) : (
          "—"
        )}
      </Row>
    </dl>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-4 py-2.5 border-b border-dashed border-[var(--color-or)]/12 last:border-b-0">
      <dt className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/80 w-[110px] shrink-0">
        {label}
      </dt>
      <dd className="flex-1 text-[var(--color-ivoire)] min-w-0">{children}</dd>
    </div>
  );
}

function ConditionChip({ code, t }) {
  // The condition is the headline state — give it a touch of weight rather
  // than the generic museum-row treatment.
  const tone =
    code === "mib_sealed"
      ? "border-[var(--color-or)] text-[var(--color-or)] bg-[var(--color-or)]/10"
      : code === "damaged"
        ? "border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)]"
        : "border-[var(--color-or)]/40 text-[var(--color-or-pale)]";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-[11px] uppercase tracking-[0.22em] border ${tone}`}
    >
      {t(`condition.${code}`)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit mode

function EditMode({ owned, onClose, t }) {
  const [form, setForm] = useState(() => seedFromOwned(owned));
  const update = useUpdateOwnedItem();

  // Re-seed when the parent loads a different owned item (defensive).
  useEffect(() => {
    setForm(seedFromOwned(owned));
  }, [owned?.id]);

  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  /** Quick-flip the condition + save it immediately. Lets the user mark
   *  "displayed" or "loose" without filling the whole form. */
  const quickCondition = (cond) =>
    update.mutate(
      { id: owned.id, patch: { condition: cond } },
      {
        onSuccess: () => setForm((s) => ({ ...s, condition: cond })),
      },
    );

  const onSubmit = async (e) => {
    e.preventDefault();
    const nz = (s) =>
      typeof s === "string" && s.trim() !== "" ? s.trim() : null;
    const num = (s) => {
      if (!s || s === "") return null;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const payload = {
      condition: form.condition,
      price_amount: num(form.price_amount),
      price_currency: form.price_amount ? form.price_currency : null,
      store: nz(form.store),
      purchase_date: form.purchase_date || null,
      location: nz(form.location),
      notes: nz(form.notes),
    };
    await update.mutateAsync({ id: owned.id, patch: payload });
    onClose();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="border border-[var(--color-or)]/25 bg-[var(--color-noir)]/40 p-5 space-y-5"
    >
      {/* Quick-flip pills — one tap to mark "displayed" / "loose" / "damaged" */}
      <div>
        <p className="micro-tight mb-2">{t("owned.editor.quick")}</p>
        <div className="flex flex-wrap gap-1.5">
          {CONDITION_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => quickCondition(c)}
              disabled={update.isPending && form.condition !== c}
              aria-pressed={form.condition === c}
              className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] border transition-colors ${
                form.condition === c
                  ? "bg-[var(--color-or)]/15 border-[var(--color-or)] text-[var(--color-or)]"
                  : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/70 hover:text-[var(--color-or-pale)]"
              }`}
            >
              {t(`condition.${c}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={t("owned.editor.field.condition")}
          value={form.condition}
          onChange={set("condition")}
          options={CONDITION_OPTIONS.map((c) => ({
            value: c,
            label: t(`condition.${c}`),
          }))}
        />
        <FormField
          label={t("owned.editor.field.purchase_date")}
          type="date"
          value={form.purchase_date}
          onChange={set("purchase_date")}
        />
      </div>

      <div className="grid sm:grid-cols-[2fr_1fr] gap-4">
        <FormField
          label={t("owned.editor.field.store")}
          value={form.store}
          onChange={set("store")}
          placeholder={t("owned.editor.ph.store")}
        />
        <FormField
          label={t("owned.editor.field.location")}
          value={form.location}
          onChange={set("location")}
          placeholder={t("owned.editor.ph.location")}
        />
      </div>

      <div className="grid sm:grid-cols-[2fr_1fr] gap-4">
        <FormField
          label={t("owned.editor.field.price")}
          type="number"
          value={form.price_amount}
          onChange={set("price_amount")}
          placeholder={t("owned.editor.ph.price")}
        />
        <Select
          label={t("owned.editor.field.currency")}
          value={form.price_currency}
          onChange={set("price_currency")}
          options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
        />
      </div>

      <label className="block">
        <span className="micro block mb-2">
          {t("owned.editor.field.notes")}
        </span>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes")(e.target.value)}
          rows={4}
          placeholder={t("owned.editor.ph.notes")}
          className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors leading-relaxed"
          style={{ fontFamily: "var(--font-sans)" }}
        />
      </label>

      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {update.error?.message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--color-or)]/15">
        <Button
          variant="ghost"
          type="button"
          onClick={onClose}
          disabled={update.isPending}
        >
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          {t("owned.editor.save")}
        </Button>
      </div>
    </form>
  );
}

function seedFromOwned(owned) {
  return {
    condition: owned.condition ?? "mib_sealed",
    price_amount: owned.price_amount != null ? String(owned.price_amount) : "",
    price_currency: owned.price_currency ?? "JPY",
    store: owned.store ?? "",
    purchase_date: owned.purchase_date ?? "",
    location: owned.location ?? "",
    notes: owned.notes ?? "",
  };
}
