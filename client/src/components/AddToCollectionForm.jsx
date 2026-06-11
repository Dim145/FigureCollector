import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import { useAddOwnedItem } from "../hooks/useCollection.js";
import { useDefaultCurrency } from "../hooks/useMe.js";
import { useCurrencies } from "../hooks/useCurrencies.js";
import Button from "./Button.jsx";
import FormField from "./FormField.jsx";
import Select from "./Select.jsx";
import StoreAutocomplete from "./StoreAutocomplete.jsx";

const CONDITION_OPTIONS = [
  "mib_sealed",
  "opened_box",
  "displayed",
  "loose",
  "damaged",
];

/**
 * Slim purchase-details form shown on /figures/:id in place of the bare
 * "Add to collection" button. Pre-fills `price` with the catalog MSRP so
 * the common case (paid full price, mint sealed, today) becomes a single
 * confirmation tap — but the user can override every field before confirming.
 *
 * The "More details" expander reveals the secondary fields (store + location
 * + notes) so the default panel stays focused on the price/condition/date
 * the user usually wants to set at purchase time.
 *
 * @param {object} props
 * @param {string} props.figureId
 * @param {number|string|null} [props.catalogMsrp]
 * @param {string|null} [props.catalogCurrency]
 * @param {(owned: object) => void} [props.onAdded]
 */
export default function AddToCollectionForm({
  figureId,
  catalogMsrp,
  catalogCurrency,
  onAdded,
}) {
  const t = useT();
  const add = useAddOwnedItem();
  const defaultCurrency = useDefaultCurrency();
  const currencyOptions = useCurrencies();
  const [moreOpen, setMoreOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    condition: "mib_sealed",
    price_amount:
      catalogMsrp != null && catalogMsrp !== "" ? String(catalogMsrp) : "",
    // Prefer the catalog's currency (matches the MSRP we pre-fill); fall
    // back to the user's preferred currency, then JPY.
    price_currency: catalogCurrency ?? defaultCurrency,
    shipping_amount: "",
    purchase_date: new Date().toISOString().slice(0, 10),
    store: "",
    location: "",
    notes: "",
  }));
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const overrideDelta = useMemo_delta(form.price_amount, catalogMsrp);

  const submit = async (e) => {
    e.preventDefault();
    const nz = (s) =>
      typeof s === "string" && s.trim() !== "" ? s.trim() : undefined;
    const num = (s) => {
      if (s === undefined || s === null || s === "") return undefined;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const payload = {
      figure_id: figureId,
      condition: form.condition,
      price_amount: num(form.price_amount),
      price_currency: num(form.price_amount) != null ? form.price_currency : undefined,
      shipping_amount: num(form.shipping_amount),
      purchase_date: form.purchase_date || undefined,
      store: nz(form.store),
      location: nz(form.location),
      notes: nz(form.notes),
    };
    const created = await add.mutateAsync(payload);
    onAdded?.(created);
  };

  return (
    <form
      onSubmit={submit}
      className="border border-[var(--color-or)]/30 bg-[var(--color-or)]/3 p-5 space-y-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
        <p className="micro">{t("addowned.eyebrow")}</p>
        {catalogMsrp != null && catalogMsrp !== "" ? (
          <button
            type="button"
            onClick={() => {
              set("price_amount")(String(catalogMsrp));
              if (catalogCurrency) set("price_currency")(catalogCurrency);
            }}
            title={t("addowned.fill_msrp")}
            className="group/msrp text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)]/70 inline-flex items-baseline gap-1 cursor-pointer hover:text-[var(--color-or-pale)] transition-colors focus:outline-none focus-visible:text-[var(--color-or)]"
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
        ) : null}
      </header>

      <div className="grid sm:grid-cols-[2fr_1.4fr_1fr] gap-3">
        <div>
          <FormField
            label={t("addowned.field.price")}
            type="number"
            value={form.price_amount}
            onChange={set("price_amount")}
            placeholder={t("addowned.field.price_ph")}
          />
          {overrideDelta ? (
            <p
              className={`mt-1 text-[10px] uppercase tracking-[0.22em] ${
                overrideDelta.direction === "above"
                  ? "text-[var(--color-laque-bright)]"
                  : "text-[var(--color-or)]"
              }`}
            >
              {overrideDelta.direction === "above"
                ? t("addowned.above_msrp", { delta: overrideDelta.label })
                : t("addowned.below_msrp", { delta: overrideDelta.label })}
            </p>
          ) : null}
        </div>
        <FormField
          label={t("addowned.field.shipping")}
          type="number"
          value={form.shipping_amount}
          onChange={set("shipping_amount")}
          placeholder={t("addowned.field.shipping_ph")}
          hint={t("addowned.field.shipping_hint")}
        />
        <Select
          label={t("addowned.field.currency")}
          value={form.price_currency}
          onChange={set("price_currency")}
          options={currencyOptions.map((c) => ({ value: c, label: c }))}
        />
      </div>

      <FormField
        label={t("addowned.field.purchase_date")}
        type="date"
        value={form.purchase_date}
        onChange={set("purchase_date")}
        hint={t("addowned.field.purchase_date_hint")}
      />

      <Select
        label={t("addowned.field.condition")}
        value={form.condition}
        onChange={set("condition")}
        options={CONDITION_OPTIONS.map((c) => ({
          value: c,
          label: t(`condition.${c}`),
        }))}
      />

      <button
        type="button"
        onClick={() => setMoreOpen((x) => !x)}
        className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
      >
        {moreOpen ? "−" : "+"} {t("addowned.more_details")}
      </button>

      {moreOpen ? (
        <div className="space-y-4 pt-2 border-t border-dashed border-[var(--color-or)]/20">
          <div className="grid sm:grid-cols-2 gap-3">
            <StoreAutocomplete
              label={t("addowned.field.store")}
              value={form.store}
              onChange={set("store")}
              placeholder={t("addowned.field.store_ph")}
            />
            <FormField
              label={t("addowned.field.location")}
              value={form.location}
              onChange={set("location")}
              placeholder={t("addowned.field.location_ph")}
            />
          </div>
          <label className="block">
            <span className="micro block mb-2">
              {t("addowned.field.notes")}
            </span>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
              rows={3}
              placeholder={t("addowned.field.notes_ph")}
              className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors leading-relaxed"
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </label>
        </div>
      ) : null}

      {add.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {add.error?.message}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        loading={add.isPending}
        className="w-full"
      >
        {t("addowned.cta")}
      </Button>
    </form>
  );
}

/** Pseudo-hook (not memoised — recomputed on every render is fine for two
 *  numeric comparisons). Returns { direction, label } when the user's
 *  override deviates from the catalog MSRP, or null otherwise. */
function useMemo_delta(paidRaw, msrpRaw) {
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
