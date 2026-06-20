import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Modal, Button } from "../ui/index.js";
import { adapterFor, paymentLabel } from "./lookupSources.js";

/**
 * Unified external-detail wizard. Collapses the old `OrzgkDetailModal` +
 * `ProxyDetailModal` (which each re-implemented the same Versions → Prices →
 * Apply flow) into ONE component driven by a source adapter (`lookupSources`).
 *
 * Flow:
 *   1. (if the product has versions) pick a version
 *   2. pick a price/tariff (auto-picked when there's exactly one)
 *   3. Apply → hands the form-prefill payload back to the parent
 *
 * Composes the shared <Modal> (focus-trap, Esc, scroll-lock, scrim) so it no
 * longer hand-rolls a portal + keydown listener.
 *
 * @param {object}   props
 * @param {"orzgk"|"proxy"} props.source
 * @param {string}   props.url        the product URL (shown in the header)
 * @param {object}   props.detail     the fetched detail/product payload (or null)
 * @param {boolean}  props.busy
 * @param {?string}  props.error
 * @param {() => void} props.onClose
 * @param {(payload: object) => void} props.onApply
 * @param {(key, opts?) => string} props.t
 */
export default function LookupDetailModal({
  source,
  url,
  detail,
  busy,
  error,
  onClose,
  onApply,
  t,
}) {
  const adapter = adapterFor(source);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedPrice, setSelectedPrice] = useState(null);
  const [step, setStep] = useState("version"); // "version" | "price"

  const versions = detail ? adapter.versions(detail) : [];
  const topPrices = detail ? adapter.prices(detail) : [];

  // Seed selection when the payload arrives.
  useEffect(() => {
    if (!detail) return;
    if (versions.length) {
      setStep("version");
      setSelectedVersion(versions.length === 1 ? versions[0] : null);
      setSelectedPrice(null);
    } else {
      setStep("price");
      setSelectedVersion(null);
      // orzgk can expose top-level prices with no versions; auto-pick a lone one.
      setSelectedPrice(topPrices.length === 1 ? topPrices[0] : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  // A version with a single tariff auto-selects it.
  useEffect(() => {
    if (selectedVersion?.prices?.length === 1) {
      setSelectedPrice(selectedVersion.prices[0]);
    }
  }, [selectedVersion]);

  const versionPrices = selectedVersion?.prices ?? topPrices;

  // Plain derived boolean (cheap; no memo — and a memo here can't be preserved
  // by the React Compiler because the deps are freshly-derived arrays).
  const canApply =
    !!detail &&
    !(versions.length && !selectedVersion) &&
    !(versionPrices.length > 0 && !selectedPrice);

  const handleApply = () => {
    if (!detail) return;
    onApply(adapter.buildPick(detail, selectedVersion, selectedPrice));
  };

  const title = detail ? adapter.title(detail) : null;
  const heroImage = detail ? adapter.image(detail, selectedVersion) : null;
  const specRows = detail ? adapter.specRows(detail) : [];

  const header = (
    <div className="min-w-0">
      <p className="micro-tight">{t(adapter.eyebrowKey)}</p>
      <h2 className="display text-2xl text-[var(--on-surface)] mt-1 leading-tight truncate">
        {title ?? t("lookup.figure.detail.loading")}
      </h2>
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--on-surface-subtle)] mt-1 truncate">
        {url}
      </p>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      className="flex flex-col max-h-[calc(100dvh-2rem)]"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button type="button" variant="primary" disabled={!canApply} onClick={handleApply}>
            {t("lookup.figure.detail.apply")}
          </Button>
        </>
      }
    >
      <div className="pr-8 mb-5">{header}</div>

      {busy ? (
        <p className="text-sm text-[var(--on-surface-muted)] italic py-8 text-center">
          {t("lookup.figure.detail.loading")}
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-[var(--danger)] py-4">
          {error}
        </p>
      ) : detail ? (
        <div className="grid md:grid-cols-[200px_1fr] gap-6">
          {/* Hero image */}
          <div className="space-y-3">
            <div className="aspect-square bg-[var(--surface-sunken)] border border-[var(--border-subtle)] overflow-hidden">
              {heroImage ? (
                <img src={heroImage} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
            {detail.images?.length > 1 ? (
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--on-surface-subtle)]">
                {detail.images.length} {t("lookup.figure.detail.images_count")}
              </p>
            ) : null}
          </div>

          {/* Spec grid + stepper */}
          <div className="space-y-5">
            <SpecGrid rows={specRows} t={t} />

            {versions.length ? (
              <Step
                n={1}
                label={t("lookup.figure.detail.step_version")}
                active={step === "version"}
                done={!!selectedVersion}
              >
                <VersionPicker
                  versions={versions}
                  selected={selectedVersion}
                  onSelect={(v) => {
                    setSelectedVersion(v);
                    setSelectedPrice(null);
                    setStep("price");
                  }}
                  t={t}
                />
              </Step>
            ) : null}

            {versions.length || topPrices.length ? (
              <Step
                n={versions.length ? 2 : 1}
                label={t("lookup.figure.detail.step_price")}
                active={step === "price" || !versions.length}
                done={!!selectedPrice}
              >
                {versionPrices.length === 0 ? (
                  <p className="text-xs text-[var(--on-surface-muted)] italic">
                    {t("lookup.figure.detail.no_prices")}
                  </p>
                ) : (
                  <PricePicker
                    prices={versionPrices}
                    selected={selectedPrice}
                    onSelect={setSelectedPrice}
                    t={t}
                  />
                )}
              </Step>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** A single `[ [i18nKey, value], … ]` spec table. Shared by both sources. */
function SpecGrid({ rows, t }) {
  if (!rows?.length) return null;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 items-baseline">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/80 shrink-0 w-[112px]">
            {t(`lookup.figure.detail.field.${k}`)}
          </dt>
          <dd className="text-sm text-[var(--on-surface)] min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Step({ n, label, active, done, children }) {
  return (
    <section
      className={`border-l-2 pl-4 ${
        done
          ? "border-[var(--accent)]/60"
          : active
            ? "border-[var(--accent)]"
            : "border-[var(--border-subtle)]"
      }`}
    >
      <p className="micro-tight flex items-center gap-2">
        <span
          className={`inline-flex items-center justify-center w-5 h-5 border text-[10px] font-mono ${
            done
              ? "bg-[var(--accent)] text-[var(--surface-raised)] border-[var(--accent)]"
              : active
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--on-surface-muted)]"
          }`}
        >
          {done ? <Check size={11} strokeWidth={2.5} /> : n}
        </span>
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function VersionPicker({ versions, selected, onSelect, t }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {versions.map((v) => {
        const isSelected = selected?.key === v.key;
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onSelect(v)}
            aria-pressed={isSelected}
            className={`flex items-center gap-3 p-2 min-h-[44px] border text-left transition-colors ${
              isSelected
                ? "border-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--accent)]/5"
            }`}
          >
            <span className="shrink-0 w-12 h-12 bg-[var(--surface-sunken)] border border-[var(--border-subtle)] overflow-hidden">
              {v.image_url ? (
                <img
                  src={v.image_url}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-[var(--on-surface)] leading-tight">
                {v.label}
              </span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--on-surface-subtle)] mt-1">
                {v.prices.length}{" "}
                {v.prices.length === 1
                  ? t("lookup.figure.detail.tariff_one", { default: "tarif" })
                  : t("lookup.figure.detail.tariff_other", { default: "tarifs" })}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PricePicker({ prices, selected, onSelect, t }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {prices.map((p, i) => {
        const isSelected = selected === p;
        return (
          <button
            key={`${p.label}-${i}-${p.display}`}
            type="button"
            onClick={() => onSelect(p)}
            aria-pressed={isSelected}
            className={`flex items-baseline justify-between gap-3 p-3 min-h-[44px] border text-left transition-colors ${
              isSelected
                ? "border-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--accent)]/5"
            }`}
          >
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/80">
              {paymentLabel(p.label, t)}
            </span>
            <span className="display text-lg text-[var(--accent)]">{p.display}</span>
          </button>
        );
      })}
    </div>
  );
}
