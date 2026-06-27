import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import {
  usePreorderForOwned,
  useRestoreOwnedItem,
  useUpdateOwnedItem,
  useUpdatePreorder,
} from "../hooks/useCollection.js";
import { useDefaultCurrency } from "../hooks/useMe.js";
import { useCurrencies } from "../hooks/useCurrencies.js";
import Button from "./Button.jsx";
import CancellationDialog from "./CancellationDialog.jsx";
import FormField from "./FormField.jsx";
import Money from "./Money.jsx";
import PriceWithBreakdown from "./PriceWithBreakdown.jsx";
import Select from "./Select.jsx";
import StoreAutocomplete from "./StoreAutocomplete.jsx";

/** Allowed condition values, mirrored from the server's allow-list. */
const CONDITION_OPTIONS = ["mib_sealed", "opened_box", "displayed", "loose", "damaged"];

/** Provenance values, mirrored from the server's `ALLOWED_ACQUISITION_SOURCES`.
 *  An empty value means "unspecified" (the column stays null). */
const ACQUISITION_SOURCES = ["purchased", "gift", "trade", "found", "inherited", "other"];

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
 * @param {number|string|null} [props.catalogMsrp]   Catalog reference price.
 *        When set, the editor renders an extra line under the "Prix payé"
 *        field showing the MSRP + a +N%/-N% delta when the user's price
 *        differs from it.
 * @param {string|null} [props.catalogCurrency]
 */
export default function OwnedItemEditor({ owned, catalogMsrp, catalogCurrency }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // The preorder (when one exists) carries the deposit amount, which the
  // price popup needs as a separate line ABOVE the figurine balance. We
  // also need it here in edit mode so the deposit input pre-fills.
  const preorder = usePreorderForOwned(owned?.id);
  const restore = useRestoreOwnedItem();

  if (!owned) return null;

  const po = preorder.data ?? null;
  const isArchived = !!owned.archived_at;
  const canCancel = !isArchived && po && po.status !== "cancelled" && po.status !== "received";

  return (
    <section>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 mb-4">
        <div>
          <p className="micro">{t("owned.editor.eyebrow")}</p>
          <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
            {t("owned.editor.title")}
          </h2>
        </div>
        {!editing ? (
          <div className="flex flex-wrap items-center gap-2">
            {isArchived ? (
              <button
                type="button"
                onClick={() => restore.mutate(owned.id)}
                disabled={restore.isPending}
                className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors border border-[var(--color-or)]/60 hover:border-[var(--color-or)] px-3 py-1.5 disabled:opacity-50"
              >
                ↺ {t("owned.editor.restore")}
              </button>
            ) : null}
            {canCancel ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setCancelOpen(true)}
              >
                × {t("owned.editor.cancel_preorder")}
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5"
            >
              ✎ {t("owned.editor.edit")}
            </button>
          </div>
        ) : null}
      </header>

      {/* Archived banner — explicit chip so the user knows why this row
       *  is hidden from the default /collection view. */}
      {isArchived ? (
        <p
          role="status"
          className="mb-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {t("owned.editor.archived_note")}
          {owned.archive_reason ? (
            <span className="opacity-80">
              {" · "}
              {t(`archive.reason.${owned.archive_reason}`)}
            </span>
          ) : null}
        </p>
      ) : null}

      {editing ? (
        <EditMode
          owned={owned}
          preorder={po}
          catalogMsrp={catalogMsrp}
          catalogCurrency={catalogCurrency}
          onClose={() => setEditing(false)}
          t={t}
        />
      ) : (
        <ReadMode
          owned={owned}
          preorder={po}
          catalogMsrp={catalogMsrp}
          catalogCurrency={catalogCurrency}
          t={t}
        />
      )}

      {cancelOpen && po ? (
        <CancellationDialog preorder={po} ownedId={owned.id} onClose={() => setCancelOpen(false)} />
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Read mode

function ReadMode({ owned, preorder, catalogMsrp, catalogCurrency, t }) {
  const deposit = preorder?.deposit_amount ?? null;
  const depositRefund = preorder?.deposit_refund_amount ?? null;
  const cancelled = preorder?.status === "cancelled";
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-1 border border-[var(--color-or)]/15 bg-[var(--color-noir)]/40 px-5 py-4">
      <Row label={t("owned.editor.field.condition")}>
        <ConditionChip code={owned.condition} t={t} />
      </Row>
      <Row label={t("owned.editor.field.purchase_date")}>
        {owned.purchase_date ? new Date(owned.purchase_date).toLocaleDateString(appLocale()) : "—"}
      </Row>
      <Row label={t("owned.editor.field.store")}>
        {owned.store_name ? (
          owned.store_slug ? (
            <Link
              to={`/catalogue/stores/${owned.store_slug}`}
              className="text-[var(--color-or-pale)] underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
            >
              {owned.store_name}
            </Link>
          ) : (
            owned.store_name
          )
        ) : (
          "—"
        )}
      </Row>
      <Row label={t("owned.editor.field.price")}>
        {owned.price_amount || owned.shipping_amount || deposit ? (
          <PriceWithBreakdown
            price={owned.price_amount}
            shipping={owned.shipping_amount}
            deposit={deposit}
            depositRefund={depositRefund}
            cancelled={cancelled}
            currency={owned.price_currency || preorder?.price_currency}
            catalog={catalogMsrp}
            catalogCurrency={catalogCurrency}
            size="sm"
          />
        ) : (
          "—"
        )}
      </Row>
      <Row label={t("owned.editor.field.source")}>
        {owned.acquisition_source || owned.acquired_from ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            {owned.acquisition_source ? (
              <span className="text-[var(--color-or-pale)]">
                {t(`owned.editor.source.${owned.acquisition_source}`)}
              </span>
            ) : null}
            {owned.acquired_from ? (
              <span className="text-[var(--color-ivoire-soft)]">
                {owned.acquisition_source ? "· " : ""}
                {owned.acquired_from}
              </span>
            ) : null}
          </span>
        ) : (
          "—"
        )}
      </Row>
      <Row label={t("owned.editor.field.location")}>{owned.location ?? "—"}</Row>
      <Row label={t("owned.editor.field.notes")}>
        {owned.notes ? (
          <span className="whitespace-pre-wrap text-[var(--color-ivoire)]">{owned.notes}</span>
        ) : (
          "—"
        )}
      </Row>
      {owned.for_sale || owned.for_trade ? (
        <Row label={t("owned.editor.sale.title")}>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
            {owned.for_sale ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] border border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)] bg-[var(--color-laque)]/10">
                {t("owned.editor.sale.for_sale")}
              </span>
            ) : null}
            {owned.for_trade ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] border border-[var(--color-or)]/50 text-[var(--color-or-pale)]">
                {t("owned.editor.sale.for_trade")}
              </span>
            ) : null}
            {owned.for_sale && owned.asking_price_amount ? (
              <span className="text-[var(--color-or)] font-medium">
                <Money
                  amount={owned.asking_price_amount}
                  currency={owned.asking_price_currency || owned.price_currency}
                />
              </span>
            ) : null}
            {owned.sale_note ? (
              <span className="block w-full whitespace-pre-wrap text-[13px] italic text-[var(--color-ivoire-soft)]">
                {owned.sale_note}
              </span>
            ) : null}
          </span>
        </Row>
      ) : null}
    </dl>
  );
}

function Row({ label, children }) {
  // Drop the dashed underline on both bottom-row cells when the dl renders
  // as a 2-column grid (sm+) — otherwise the bottom-left cell keeps a stray
  // hairline while the bottom-right doesn't, breaking the rhythm. The
  // 1-col layout still respects `last:`.
  return (
    <div className="flex items-baseline gap-4 py-2.5 border-b border-dashed border-[var(--color-or)]/12 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
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

function EditMode({ owned, preorder, catalogMsrp, catalogCurrency, onClose, t }) {
  const defaultCurrency = useDefaultCurrency();
  const currencyOptions = useCurrencies();
  const [form, setForm] = useState(() => seedFromOwned(owned, preorder, defaultCurrency));
  const update = useUpdateOwnedItem();
  // The deposit lives on the linked preorder row, not on the owned_item,
  // so we patch it via a separate mutation when the field changes. The
  // user still experiences a single Save — both calls fire on submit.
  const updatePreorder = useUpdatePreorder();
  const delta = priceDelta(form.price_amount, catalogMsrp);

  // Re-seed when the parent loads a different owned item (defensive).
  useEffect(() => {
    setForm(seedFromOwned(owned, preorder, defaultCurrency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned?.id, preorder?.id, preorder?.deposit_amount]);

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
    const nz = (s) => (typeof s === "string" && s.trim() !== "" ? s.trim() : null);
    const num = (s) => {
      if (!s || s === "") return null;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const payload = {
      condition: form.condition,
      price_amount: num(form.price_amount),
      price_currency: form.price_amount ? form.price_currency : null,
      shipping_amount: num(form.shipping_amount),
      store: nz(form.store),
      purchase_date: form.purchase_date || null,
      location: nz(form.location),
      notes: nz(form.notes),
      // Provenance — mirrors location/notes: empty → null. The server PATCH
      // COALESCEs nulls (omitted = unchanged), so blanking a field leaves the
      // stored value as-is, exactly like the other free-text owned fields.
      acquisition_source: form.acquisition_source || null,
      acquired_from: nz(form.acquired_from),
      // Booleans are always sent so toggling OFF persists (server COALESCEs
      // nulls, not falses). Asking price only when actually selling.
      for_sale: !!form.for_sale,
      for_trade: !!form.for_trade,
      asking_price_amount: form.for_sale ? num(form.asking_price_amount) : null,
      asking_price_currency:
        form.for_sale && form.asking_price_amount ? form.asking_price_currency : null,
      sale_note: form.for_sale || form.for_trade ? nz(form.sale_note) : null,
    };
    await update.mutateAsync({ id: owned.id, patch: payload });
    // Patch the preorder's deposit too, when the field is editable
    // (only meaningful if a preorder exists for this owned item).
    if (preorder?.id) {
      const nextDeposit = num(form.deposit_amount);
      const prevDeposit = preorder.deposit_amount != null ? Number(preorder.deposit_amount) : null;
      // Skip the call when nothing changed — saves a roundtrip on the
      // common case "the user only edited the price".
      if (nextDeposit !== prevDeposit) {
        await updatePreorder.mutateAsync({
          id: preorder.id,
          patch: { deposit_amount: nextDeposit },
        });
      }
    }
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
        <StoreAutocomplete
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

      {/* Provenance — how the piece entered the collection + from whom/where.
          The source carries an empty "unspecified" option (the column is
          nullable); manual entry of "acquired from" is always free text. */}
      <div className="grid sm:grid-cols-[1fr_2fr] gap-4">
        <Select
          label={t("owned.editor.field.source")}
          value={form.acquisition_source}
          onChange={set("acquisition_source")}
          options={[
            { value: "", label: t("owned.editor.source.unset") },
            ...ACQUISITION_SOURCES.map((s) => ({
              value: s,
              label: t(`owned.editor.source.${s}`),
            })),
          ]}
        />
        <FormField
          label={t("owned.editor.field.acquired_from")}
          value={form.acquired_from}
          onChange={set("acquired_from")}
          placeholder={t("owned.editor.ph.acquired_from")}
        />
      </div>

      <div className="grid sm:grid-cols-[2fr_1.4fr_1fr] gap-4 items-start">
        <div>
          <FormField
            label={t("owned.editor.field.price")}
            type="number"
            value={form.price_amount}
            onChange={set("price_amount")}
            placeholder={t("owned.editor.ph.price")}
          />
          {catalogMsrp != null && catalogMsrp !== "" ? (
            <p className="mt-1 flex items-baseline gap-2 text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)]/70">
              <button
                type="button"
                onClick={() => {
                  set("price_amount")(String(catalogMsrp));
                  if (catalogCurrency) set("price_currency")(catalogCurrency);
                }}
                title={t("addowned.fill_msrp")}
                className="group/msrp inline-flex items-baseline gap-1 cursor-pointer hover:text-[var(--color-or-pale)] transition-colors focus:outline-none focus-visible:text-[var(--color-or)]"
              >
                <span>
                  {t("addowned.msrp_ref")}:{" "}
                  <span className="font-mono text-[var(--color-or-pale)] group-hover/msrp:text-[var(--color-or)] underline decoration-dotted decoration-[var(--color-or)]/40 underline-offset-4 group-hover/msrp:decoration-[var(--color-or)] transition-colors">
                    {fmtMoney(catalogMsrp)} {catalogCurrency ?? ""}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="text-[var(--color-or)]/0 group-hover/msrp:text-[var(--color-or)]/80 transition-colors text-[9px]"
                >
                  ↩
                </span>
              </button>
              {delta ? (
                <span
                  className={
                    delta.direction === "above"
                      ? "text-[var(--color-laque-bright)]"
                      : "text-[var(--color-or)]"
                  }
                >
                  · {delta.label}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <FormField
          label={t("owned.editor.field.shipping")}
          type="number"
          value={form.shipping_amount}
          onChange={set("shipping_amount")}
          placeholder={t("owned.editor.ph.shipping")}
        />
        <Select
          label={t("owned.editor.field.currency")}
          value={form.price_currency}
          onChange={set("price_currency")}
          options={currencyOptions.map((c) => ({ value: c, label: c }))}
        />
      </div>

      {/* Deposit row — only meaningful when a preorder exists for this
       *  owned item. The deposit lives on the preorder row, but the UX
       *  ties price + shipping + deposit together because they're three
       *  facets of the same "what did this figurine cost me" question. */}
      {preorder ? (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <FormField
              label={t("owned.editor.field.deposit")}
              type="number"
              value={form.deposit_amount}
              onChange={set("deposit_amount")}
              placeholder={t("owned.editor.ph.deposit")}
            />
            <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)]/55">
              {t("owned.editor.deposit_hint")}
            </p>
          </div>
        </div>
      ) : null}

      <label className="block">
        <span className="micro block mb-2">{t("owned.editor.field.notes")}</span>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes")(e.target.value)}
          rows={4}
          placeholder={t("owned.editor.ph.notes")}
          className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors leading-relaxed"
          style={{ fontFamily: "var(--font-sans)" }}
        />
      </label>

      {/* À vendre / à échanger — marketplace flags surfaced on the public
          showcase. Asking price + a public note appear once "à vendre" is on. */}
      <div className="border-t border-[var(--color-or)]/15 pt-5">
        <p className="micro mb-1">{t("owned.editor.sale.title")}</p>
        <p className="micro-tight mb-3 text-[var(--color-ivoire-soft)]/60">
          {t("owned.editor.sale.hint")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "for_sale", label: t("owned.editor.sale.for_sale") },
            { key: "for_trade", label: t("owned.editor.sale.for_trade") },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={!!form[key]}
              onClick={() => set(key)(!form[key])}
              className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] border transition-colors ${
                form[key]
                  ? "bg-[var(--color-laque)]/15 border-[var(--color-laque-bright)] text-[var(--color-laque-bright)]"
                  : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/70 hover:text-[var(--color-or-pale)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {form.for_sale ? (
          <div className="mt-4 grid sm:grid-cols-[2fr_1fr] gap-4">
            <FormField
              label={t("owned.editor.sale.asking_price")}
              type="number"
              value={form.asking_price_amount}
              onChange={set("asking_price_amount")}
              placeholder={t("owned.editor.sale.asking_price_ph")}
            />
            <Select
              label={t("owned.editor.field.currency")}
              value={form.asking_price_currency}
              onChange={set("asking_price_currency")}
              options={currencyOptions.map((c) => ({ value: c, label: c }))}
            />
          </div>
        ) : null}
        {form.for_sale || form.for_trade ? (
          <label className="block mt-4">
            <span className="micro block mb-2">{t("owned.editor.sale.note")}</span>
            <textarea
              value={form.sale_note}
              onChange={(e) => set("sale_note")(e.target.value)}
              rows={2}
              placeholder={t("owned.editor.sale.note_ph")}
              className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors leading-relaxed"
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </label>
        ) : null}
      </div>

      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {update.error?.message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--color-or)]/15">
        <Button variant="ghost" type="button" onClick={onClose} disabled={update.isPending}>
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          {t("owned.editor.save")}
        </Button>
      </div>
    </form>
  );
}

function seedFromOwned(owned, preorder, defaultCurrency = "JPY") {
  return {
    condition: owned.condition ?? "mib_sealed",
    price_amount: owned.price_amount != null ? String(owned.price_amount) : "",
    price_currency: owned.price_currency ?? defaultCurrency,
    shipping_amount: owned.shipping_amount != null ? String(owned.shipping_amount) : "",
    deposit_amount: preorder?.deposit_amount != null ? String(preorder.deposit_amount) : "",
    // Seed from the joined store_name when the server resolved one; we still
    // round-trip it as a free-text `store` field so the upsert can rebind
    // by slug on save.
    store: owned.store_name ?? "",
    // Fall back to the date the row was added when no explicit purchase
    // date was ever set — for most collectors those are the same day.
    purchase_date:
      owned.purchase_date ?? (owned.created_at ? String(owned.created_at).slice(0, 10) : ""),
    location: owned.location ?? "",
    notes: owned.notes ?? "",
    acquisition_source: owned.acquisition_source ?? "",
    acquired_from: owned.acquired_from ?? "",
    for_sale: !!owned.for_sale,
    for_trade: !!owned.for_trade,
    asking_price_amount: owned.asking_price_amount != null ? String(owned.asking_price_amount) : "",
    asking_price_currency: owned.asking_price_currency ?? owned.price_currency ?? defaultCurrency,
    sale_note: owned.sale_note ?? "",
  };
}

/** Compare paid vs catalog MSRP. Returns null when either is missing or the
 *  two values are within 1 cent of each other; otherwise returns
 *  { direction: "above" | "below", label: "+12%" | "-8%" }. */
function priceDelta(paidRaw, msrpRaw) {
  const paid = Number(paidRaw);
  const msrp = Number(msrpRaw);
  if (!Number.isFinite(paid) || !Number.isFinite(msrp) || msrp === 0) return null;
  if (Math.abs(paid - msrp) < 0.01) return null;
  const diff = paid - msrp;
  const pct = ((diff / msrp) * 100).toFixed(0);
  return {
    direction: diff > 0 ? "above" : "below",
    label: `${diff > 0 ? "+" : ""}${pct}%`,
  };
}

function fmtMoney(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(appLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
