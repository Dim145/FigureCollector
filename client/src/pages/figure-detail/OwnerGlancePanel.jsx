import { useMemo, useState } from "react";
import { usePreorderForOwned } from "../../hooks/useCollection.js";
import {
  useWishlistItems,
  useAddWishlistItem,
  useRemoveWishlistItem,
} from "../../hooks/useWishlist.js";
import { useFigurePriceHistory } from "../../hooks/useStats.js";
import { effectiveValue, figurePaid } from "../../lib/money.js";
import { preorderPhase } from "../../lib/preorderStatus.js";
import Money from "../../components/Money.jsx";
import PriceHistoryDialog, { StepSparkline, toSeries } from "../../components/PriceHistory.jsx";

/**
 * Read-only owner "glance" cluster shown in the hero's right column: the
 * pré-commande *acompte* progress (red→gold) and *La Cote* (payé vs valeur +
 * gain). Derived from the owned record + its linked preorder; the editable
 * detail lives in the owner stack below. Renders nothing when neither block
 * has data, so a released-and-unpriced piece shows no empty box.
 */
export function OwnerGlance({ f, owned, t, delay = 7 }) {
  const preorder = usePreorderForOwned(owned.id);
  const po = preorder.data ?? null;

  // Acompte: deposit paid against the total figurine cost. The total is the
  // owned price when known, else the catalog MSRP — the same fallback the
  // editor uses. Only shown when a deposit exists and the order isn't
  // cancelled/received (those are historical, not "in progress").
  const deposit = po?.deposit_amount != null ? Number(po.deposit_amount) : null;
  const totalRaw =
    owned.price_amount != null
      ? Number(owned.price_amount)
      : f.msrp_amount != null
        ? Number(f.msrp_amount)
        : null;
  const depositCurrency = owned.price_currency || po?.price_currency || f.msrp_currency || null;
  const phase = preorderPhase(owned);
  const acompteActive =
    deposit != null &&
    deposit > 0 &&
    totalRaw != null &&
    totalRaw > 0 &&
    phase !== "cancelled" &&
    phase !== "received";

  // La Cote: figure price vs effective value (manual value, else MSRP). The
  // gain compares against the PRICE only (shipping excluded — a sunk cost), so
  // it matches the Cote page and a shipped piece isn't shown at a perpetual loss.
  const value = effectiveValue({
    value_amount: owned.value_amount,
    value_currency: owned.value_currency,
    price_currency: owned.price_currency,
    provider_price_amount: owned.provider_price_amount,
    provider_price_currency: owned.provider_price_currency,
    msrp_amount: f.msrp_amount,
    msrp_currency: f.msrp_currency,
  });
  const paid = figurePaid(owned);
  // Only compute a gain when both are in the SAME currency (no FX layer).
  const sameCurrency = paid && value && (paid.currency || "") === (value.currency || "");
  const gain = sameCurrency && paid.amount > 0 ? value.amount - paid.amount : null;
  const gainPct = gain != null && paid.amount > 0 ? Math.round((gain / paid.amount) * 100) : null;
  const coteActive = !!(paid || value);

  if (!acompteActive && !coteActive) return null;

  return (
    <div className="mt-8 space-y-4 reveal" style={{ "--i": delay }}>
      {acompteActive ? (
        <AcompteBar deposit={deposit} total={totalRaw} currency={depositCurrency} t={t} />
      ) : null}
      {coteActive ? (
        <CoteGlance
          paid={paid}
          value={value}
          gain={gain}
          gainPct={gainPct}
          figureId={f.id}
          figureName={f.name}
          t={t}
        />
      ) : null}
    </div>
  );
}

/** Pré-commande acompte progress — a red→gold bar (paid share of the total),
 *  with "acompte versé" (gold) and "solde restant" (red) figures beneath.
 *  Static gradient fill, no animation — GPU-light. */
function AcompteBar({ deposit, total, currency, t }) {
  const pct = Math.max(0, Math.min(100, Math.round((deposit / total) * 100)));
  const balance = Math.max(0, total - deposit);
  return (
    <section
      aria-label={t("figure.glance.acompte", { default: "Pré-commande · acompte" })}
      className="border border-[var(--color-or)]/20 bg-[var(--color-noir-soft)] p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <p className="micro-tight flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm leading-none">
            予
          </span>
          {t("figure.glance.acompte", { default: "Pré-commande · acompte" })}
        </p>
        <span className="font-mono text-sm text-[var(--color-or)]">{pct} %</span>
      </header>
      <div
        className="mt-3.5 h-2 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ background: "color-mix(in oklab, var(--color-ivoire) 8%, transparent)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--color-laque-bright), var(--color-or))",
          }}
        />
      </div>
      <div className="mt-3.5 flex items-end justify-between gap-4">
        <div>
          <p className="micro-tight">
            {t("figure.glance.deposit_paid", { default: "Acompte versé" })}
          </p>
          <p className="figural text-2xl text-[var(--color-or)] leading-none mt-1.5">
            <Money amount={deposit} currency={currency} />
          </p>
        </div>
        <div className="text-right">
          <p className="micro-tight">
            {t("figure.glance.balance_due", { default: "Solde restant" })}
          </p>
          <p className="figural text-2xl text-[var(--color-laque-bright)] leading-none mt-1.5">
            <Money amount={balance} currency={currency} />
          </p>
        </div>
      </div>
    </section>
  );
}

/** La Cote glance — payé vs valeur actuelle, with the latent gain in jade/red.
 *  Value is gold (money), the loss-or-gain tints with the figure's direction. */
function CoteGlance({ paid, value, gain, gainPct, figureId, figureName, t }) {
  const up = gain != null && gain >= 0;
  const locale = document.documentElement.lang || undefined;
  // Market-price history → the discreet sparkline + the évolution dialog.
  // Hidden entirely below 2 points (nothing worth charting yet).
  const hist = useFigurePriceHistory(figureId);
  const series = useMemo(() => toSeries(hist.data), [hist.data]);
  const [histOpen, setHistOpen] = useState(false);
  return (
    <section
      aria-label={t("cote.title")}
      className="border border-[var(--color-or)]/20 bg-[var(--color-noir-soft)] p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <p className="micro-tight flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm leading-none">
            金
          </span>
          {t("cote.title")} · {t("figure.glance.valuation", { default: "valorisation" })}
        </p>
        {gainPct != null ? (
          <span
            className="font-mono text-sm"
            style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}
          >
            {up ? "▲" : "▼"} {gainPct > 0 ? "+" : ""}
            {gainPct} %
          </span>
        ) : null}
      </header>
      <div className="mt-3.5 flex items-end justify-between gap-4">
        <div>
          <p className="micro-tight">{t("cote.paid_abbr")}</p>
          <p className="figural text-2xl text-[var(--color-ivoire)] leading-none mt-1.5">
            {paid ? <Money amount={paid.amount} currency={paid.currency} /> : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="micro-tight">
            {t("figure.glance.current_value", { default: "Valeur actuelle" })}
          </p>
          <p className="figural text-2xl text-[var(--color-or)] leading-none mt-1.5">
            {value ? <Money amount={value.amount} currency={value.currency} /> : "—"}
          </p>
          {series.length >= 2 ? (
            <div className="mt-2.5 flex flex-col items-end gap-1">
              <StepSparkline points={series} width={124} height={26} />
              <button
                type="button"
                onClick={() => setHistOpen(true)}
                className="micro inline-flex items-center gap-1.5 text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
              >
                <span aria-hidden className="ja not-italic text-[var(--color-or)]">
                  推
                </span>
                {t("cote.history.evolution")} →
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {gain != null && gain !== 0 ? (
        <p
          className="mt-3.5 pt-3 border-t border-[var(--color-or)]/12 text-[10px] uppercase tracking-[0.22em]"
          style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}
        >
          {up
            ? t("figure.glance.gain", { default: "Plus-value latente" })
            : t("figure.glance.loss", { default: "Moins-value latente" })}{" "}
          <span className="font-mono normal-case tracking-normal">
            {gain > 0 ? "+" : ""}
            <Money amount={gain} currency={value.currency} />
          </span>
        </p>
      ) : null}
      <PriceHistoryDialog
        open={histOpen}
        onClose={() => setHistOpen(false)}
        figureId={figureId}
        figureName={figureName}
        points={series}
        currency={value?.currency}
        locale={locale}
      />
    </section>
  );
}

/** Prominent wishlist toggle shown when the piece isn't already owned (owned ≠
 *  wishlist). Adding to the collection clears any wish server-side, so this
 *  control simply disappears on the next render. */
export function WishlistCta({ figureId, t }) {
  const wishlist = useWishlistItems();
  const add = useAddWishlistItem();
  const remove = useRemoveWishlistItem();
  const wished = (wishlist.data ?? []).some((w) => w.figure_id === figureId);
  const busy = add.isPending || remove.isPending;
  return (
    <button
      type="button"
      onClick={() => (wished ? remove.mutate(figureId) : add.mutate({ figure_id: figureId }))}
      disabled={busy}
      aria-pressed={wished}
      className={`wish-cta ${wished ? "wish-cta--on" : "wish-cta--off"}`}
    >
      <span className="wish-cta-heart" aria-hidden>
        {wished ? "♥" : "♡"}
      </span>
      {wished ? t("wishlist.remove") : t("wishlist.add")}
    </button>
  );
}

/** Confirmation seal shown in the hero action slot once the piece is owned. */
export function OwnedConfirmation({ t }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border border-[var(--color-or)]/40 bg-[var(--color-or)]/5">
      <span
        aria-hidden
        className="w-2 h-2 bg-[var(--color-or)] rotate-45"
        style={{ boxShadow: "0 0 10px var(--color-or)" }}
      />
      <p className="micro">{t("figure.already_owned")}</p>
    </div>
  );
}
