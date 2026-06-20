import { useEffect, useMemo, useState } from "react";
import { Search, ChevronLeft } from "lucide-react";
import Button from "../../components/Button.jsx";
import FormField from "../../components/FormField.jsx";
import Select from "../../components/Select.jsx";
import StoreAutocomplete from "../../components/StoreAutocomplete.jsx";
import Modal from "../../components/ui/Modal.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import Input from "../../components/ui/Input.jsx";
import { useFigures, useCreatePreorder } from "../../hooks/useCollection.js";
import { useCurrencies } from "../../hooks/useCurrencies.js";
import { resolveFigureCover } from "../../lib/coverUrl.js";
import { CURRENCY_LABELS } from "../../lib/money.js";
import { STATUS_OPTIONS } from "./preorderConstants.js";

/**
 * "＋ Ajouter une pré-commande" — the page's single primary CTA, opened from
 * the PageLayout toolbar. The create endpoint links to a catalogue figure
 * (figure_id is a FK), so step 1 is a name search over the local catalogue;
 * step 2 captures the order details. Manual entry stays possible because the
 * figure itself can always be created first via /figures/new (linked here when
 * a search comes up empty) — we never require an external metadata source.
 *
 * Two-step flow inside one Modal:
 *   1. pick  — debounced /figures?q= search, results as a thumbnail list
 *   2. fields — status · store · ref · release date · deposit · full price
 */
export default function PreorderAddDialog({ open, onClose, defaultCurrency, t }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("preorders.add.title", { default: "Ajouter une pré-commande" })}
    >
      {/* The flow state lives below the Modal boundary: Modal renders null when
       *  closed, so AddFlow unmounts on close and remounts fresh on reopen —
       *  no reset effect needed. */}
      <AddFlow defaultCurrency={defaultCurrency} onClose={onClose} t={t} />
    </Modal>
  );
}

function AddFlow({ defaultCurrency, onClose, t }) {
  const [step, setStep] = useState("pick");
  const [figure, setFigure] = useState(null);

  const choose = (f) => {
    setFigure(f);
    setStep("fields");
  };

  if (step === "pick") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--on-surface-muted)]">
          {t("preorders.add.pick_hint", {
            default: "Choisis la figurine concernée dans le catalogue.",
          })}
        </p>
        <FigurePicker onPick={choose} t={t} />
      </div>
    );
  }
  return (
    <DetailsForm
      figure={figure}
      defaultCurrency={defaultCurrency}
      onBack={() => setStep("pick")}
      onClose={onClose}
      t={t}
    />
  );
}

// =============================================================================
// Step 1 — figure picker
// =============================================================================

function FigurePicker({ onPick, t }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const enabled = debounced.length >= 2;
  const figures = useFigures({ q: debounced }, { enabled });
  const results = enabled ? (figures.data ?? []) : [];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-subtle)] pointer-events-none"
        />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("preorders.add.search_ph", {
            default: "Rechercher une figurine par nom…",
          })}
          aria-label={t("preorders.field.figure")}
          className="pl-9"
        />
      </div>

      <div className="min-h-[8rem] max-h-[42vh] overflow-y-auto">
        {!enabled ? (
          <p className="py-8 text-center text-sm text-[var(--on-surface-muted)]">
            {t("preorders.add.search_prompt", {
              default: "Tape au moins deux lettres pour rechercher.",
            })}
          </p>
        ) : figures.isLoading ? (
          <div className="py-8 flex justify-center">
            <Spinner size={22} label={t("preorders.add.searching", { default: "Recherche…" })} />
          </div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[var(--on-surface-muted)]">
              {t("preorders.add.no_results", { default: "Aucune figurine trouvée." })}
            </p>
            <a
              href="/figures/new"
              className="mt-3 inline-flex items-center gap-2 min-h-[44px] px-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] border border-[var(--color-or)]/30 hover:border-[var(--color-or)] transition-colors"
            >
              {t("preorders.add.create_figure", { default: "Créer la figurine d'abord" })}
            </a>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {results.map((f) => (
              <li key={f.id}>
                <FigureResultRow figure={f} onPick={onPick} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FigureResultRow({ figure: f, onPick }) {
  const cover = resolveFigureCover(f);
  return (
    <button
      type="button"
      onClick={() => onPick(f)}
      className="w-full flex items-center gap-3 p-2 text-left border border-transparent hover:border-[var(--color-or)]/30 hover:bg-[var(--surface-sunken)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span className="shrink-0 w-11 h-11 bg-[var(--surface-sunken)] border border-[var(--border-subtle)] overflow-hidden grid place-items-center">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden className="ja text-[var(--on-surface-subtle)] text-lg">
            予
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--on-surface)]">{f.name}</span>
        {f.manufacturer_name ? (
          <span className="block truncate text-xs text-[var(--on-surface-muted)]">
            {f.manufacturer_name}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// =============================================================================
// Step 2 — order details
// =============================================================================

function DetailsForm({ figure, defaultCurrency, onBack, onClose, t }) {
  const currencies = useCurrencies();
  const create = useCreatePreorder();
  const [form, setForm] = useState(() => ({
    status: "preordered",
    store: "",
    order_ref: "",
    release_date: figure?.release_date ?? "",
    price_amount: "",
    price_currency: (defaultCurrency || "JPY").toUpperCase(),
    deposit_amount: "",
  }));
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const currencyOptions = useMemo(
    () => currencies.map((c) => ({ value: c, label: CURRENCY_LABELS[c] ?? c })),
    [currencies],
  );

  const cover = resolveFigureCover(figure);

  const onSubmit = async (e) => {
    e.preventDefault();
    const nz = (s) => (typeof s === "string" && s.trim() !== "" ? s.trim() : null);
    const num = (s) => {
      if (!s || s === "") return null;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const payload = {
      figure_id: figure.id,
      status: form.status,
      store: nz(form.store),
      order_ref: nz(form.order_ref),
      release_date: form.release_date || null,
      price_amount: num(form.price_amount),
      price_currency: form.price_amount ? form.price_currency : null,
      deposit_amount: num(form.deposit_amount),
    };
    await create.mutateAsync(payload);
    onClose();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Chosen figure summary + change affordance */}
      <div className="flex items-center gap-3 p-2.5 bg-[var(--surface-sunken)] border border-[var(--border-subtle)]">
        <span className="shrink-0 w-12 h-12 bg-[var(--surface)] border border-[var(--border-subtle)] overflow-hidden grid place-items-center">
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <span aria-hidden className="ja text-[var(--on-surface-subtle)] text-lg">
              予
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-[var(--on-surface)]">{figure?.name}</span>
          {figure?.manufacturer_name ? (
            <span className="block truncate text-xs text-[var(--on-surface-muted)]">
              {figure.manufacturer_name}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 inline-flex items-center gap-1 min-h-[44px] px-2 text-[11px] uppercase tracking-[0.18em] text-[var(--on-surface-muted)] hover:text-[var(--color-or)] transition-colors"
        >
          <ChevronLeft size={14} aria-hidden />
          {t("preorders.add.change_figure", { default: "Changer" })}
        </button>
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

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <FormField
            label={t("preorders.add.price", { default: "Prix total" })}
            type="number"
            value={form.price_amount}
            onChange={set("price_amount")}
            placeholder={t("preorders.add.price_ph", { default: "ex. 18800" })}
            hint={t("preorders.add.price_hint", {
              default: "Le total — sert à calculer le solde restant.",
            })}
          />
        </div>
        <Select
          label={t("preorders.add.currency", { default: "Devise" })}
          value={form.price_currency}
          onChange={set("price_currency")}
          options={currencyOptions}
        />
      </div>

      <FormField
        label={t("preorders.field.deposit")}
        type="number"
        value={form.deposit_amount}
        onChange={set("deposit_amount")}
        placeholder={t("preorders.field.deposit_ph")}
        hint={t("preorders.field.deposit_hint")}
      />

      {create.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {create.error?.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-1">
        <Button variant="ghost" type="button" onClick={onClose} disabled={create.isPending}>
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          {t("preorders.add.submit", { default: "Ajouter" })}
        </Button>
      </div>
    </form>
  );
}
