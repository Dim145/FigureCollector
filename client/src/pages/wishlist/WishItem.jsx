import { Pencil, X } from "lucide-react";
import { Button } from "../../components/ui/index.js";
import FigureCard from "../../components/FigureCard.jsx";
import Money from "../../components/Money.jsx";
import { useDisplayCurrency } from "../../components/DisplayCurrencyProvider.jsx";
import { fmtMoney } from "../../lib/money.js";
import { coverFor, dealIsMet, marketPrice } from "./dealLogic.js";
import { StepSparkline } from "../../components/PriceHistory.jsx";

/**
 * One coveted piece — the composed FigureCard with a wishlist action tray
 * beneath it. At rest the tray shows the gold target-price chip (or "libre"), a
 * "sous la cible" deal note + the user's reminder, and the Acquérir CTA with
 * quiet edit/remove affordances. Editing swaps the tray for the inline
 * price/note form. Mutation payloads are unchanged from the original page; only
 * the chrome is restyled to semantic tokens (gold = value, red = wish/loss).
 */
export default function WishItem({
  it,
  t,
  // Floor / ceiling read from the market-price history (see priceFloor.js).
  // Undefined when the figure has fewer than two comparable relevés.
  floor,
  locale,
  prefCurrency,
  blur,
  editing,
  draftAmount,
  draftNote,
  setDraftAmount,
  setDraftNote,
  onStartEdit,
  onCancelEdit,
  onSave,
  onAcquire,
  onRemove,
  saving,
  acquiring,
}) {
  const dc = useDisplayCurrency();
  const priced = it.max_price_amount != null;
  const deal = dealIsMet(it, prefCurrency, dc.rates);
  const currency = it.max_price_currency || prefCurrency;

  return (
    <div className="h-full flex flex-col">
      <FigureCard
        figureId={it.figure_id}
        href={`/figures/${it.figure_id}`}
        name={it.figure_name}
        type={it.figure_type}
        manufacturer={it.manufacturer_name}
        imageUrl={coverFor(it)}
        scale={it.scale}
        wished
        // Best availability across the figure's linked shops (7-day freshness
        // window, server-side). Unknown ⇒ the badge renders nothing.
        stockStatus={it.stock_status}
        blurImage={blur}
      />

      {editing ? (
        /* Inline target-price / note editor — same mutation payload as before. */
        <div className="mt-3 px-1 space-y-2">
          <label
            className="flex items-center bg-[var(--surface-sunken)]"
            style={{ border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)" }}
          >
            <span className="px-2.5 text-[var(--accent)] font-mono text-xs">{currency}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancelEdit();
              }}
              placeholder={t("wishlist.target_ph")}
              aria-label={t("wishlist.edit_target")}
              className="flex-1 w-full bg-transparent text-[var(--on-surface)] font-mono text-sm py-2 pr-2 outline-none"
            />
          </label>
          <input
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancelEdit();
            }}
            placeholder={t("wishlist.note_ph")}
            aria-label={t("wishlist.note_ph")}
            className="w-full bg-[var(--surface-sunken)] text-[var(--on-surface)] text-[12px] px-2.5 py-2 outline-none transition-colors focus:border-[var(--accent)]"
            style={{
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
            }}
          />
          <div className="flex gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saving}
              loading={saving}
              className="flex-1 uppercase"
            >
              {t("editor.save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelEdit} className="uppercase">
              {t("editor.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Action tray — gold target-price chip + edit affordance. */}
          <div className="mt-3 px-1 min-h-[2.25rem] flex items-center justify-between gap-3">
            {priced ? (
              <span
                className="inline-flex items-baseline gap-1.5 text-[11px] font-mono tracking-wide px-2 py-1"
                style={{
                  color: "var(--accent)",
                  border: "1px solid color-mix(in oklab, var(--accent) 32%, transparent)",
                  background: "color-mix(in oklab, var(--accent) 7%, transparent)",
                  borderRadius: "var(--radius-sm)",
                }}
                title={t("wishlist.target")}
              >
                <span className="text-[8.5px] uppercase tracking-[0.18em] text-[var(--accent)]/80">
                  {t("wishlist.target")}
                </span>
                <span className="figural text-[13px] text-[var(--on-surface)]">
                  ≤ <Money amount={it.max_price_amount} currency={currency} />
                </span>
              </span>
            ) : (
              <span className="micro-tight text-[var(--on-surface-subtle)]">
                {t("wishlist.no_target")}
              </span>
            )}

            <button
              type="button"
              onClick={onStartEdit}
              title={t("wishlist.edit_target")}
              aria-label={t("wishlist.edit_target")}
              className="tap-target shrink-0 w-11 h-11 grid place-items-center text-[var(--accent)] hover:text-[var(--on-surface)] transition-colors"
            >
              <Pencil size={15} />
            </button>
          </div>

          {/* Floor radar — where today's price sits in its own observed range.
              A wishlist is a waiting game: "cheapest ever seen" and "hasn't
              moved in N days" are what decide whether to strike now. */}
          {floor ? (
            <div className="mt-2 px-1 flex items-center gap-2">
              <StepSparkline points={floor.points} width={72} height={18} />
              <span className="text-[10px] tracking-[0.1em] text-[var(--on-surface-muted)]">
                {floor.atFloor
                  ? t("wishlist.floor.at", { default: "au plancher observé" })
                  : t("wishlist.floor.above", {
                      pct: floor.aboveFloorPct.toFixed(0),
                      p: fmtMoney(floor.floor, floor.currency || prefCurrency, locale),
                      default: `+${floor.aboveFloorPct.toFixed(0)} % au-dessus du plancher`,
                    })}
                {floor.stableDays >= 14 ? (
                  <span className="opacity-60">
                    {" · "}
                    {t("wishlist.floor.stable", {
                      d: floor.stableDays,
                      default: `stable depuis ${floor.stableDays} j`,
                    })}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}

          {/* Deal note + the user's reminder — quiet, value-toned. */}
          {deal ? (
            <p className="mt-2 px-1 text-[10px] uppercase tracking-[0.12em] text-[var(--success)]">
              ◆{" "}
              {t("wishlist.under_target", {
                p: fmtMoney(
                  marketPrice(it)?.amount,
                  marketPrice(it)?.currency || prefCurrency,
                  locale,
                ),
              })}
            </p>
          ) : null}
          {it.note ? (
            <p
              className="mt-2 px-1 text-[11px] italic text-[var(--on-surface-muted)] line-clamp-2 border-l-2 pl-2"
              style={{ borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)" }}
            >
              {it.note}
            </p>
          ) : null}

          {/* Acquire (red hanko pill) + remove. */}
          <div className="mt-3 px-1 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={onAcquire}
              disabled={acquiring}
              loading={acquiring}
              className="flex-1 uppercase"
            >
              {t("wishlist.acquire")}
            </Button>
            <button
              type="button"
              onClick={onRemove}
              title={t("wishlist.remove")}
              aria-label={t("wishlist.remove")}
              className="tap-target shrink-0 w-11 h-11 grid place-items-center border text-[var(--on-surface-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
              style={{ borderColor: "var(--border)", borderRadius: "var(--radius-sm)" }}
            >
              <X size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
