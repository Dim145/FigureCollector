import { useMemo } from "react";
import Money from "../../components/Money.jsx";
import { useDisplayCurrency } from "../../components/DisplayCurrencyProvider.jsx";
import { toDisplay } from "../../lib/money.js";
import { useMe } from "../../hooks/useMe.js";

/** How far ahead the plan looks. A year covers the usual pre-order horizon. */
const MONTHS = 12;

/** Statuses that will never debit anything more. */
const SETTLED = new Set(["cancelled", "received"]);

/** "2027-03" → a short month label in the active locale. */
function monthLabel(key, locale) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString(locale, { month: "short", year: "2-digit" })
    .replace(".", "");
}

/**
 * 財 Plan de trésorerie — what the shelf will actually cost, month by month.
 *
 * The ribbon above shows two totals (deposits paid, balance due) with no time
 * axis, but pre-orders fail on *timing*: four orders placed months apart can
 * all settle in the same month, and the deposit already paid makes backing out
 * expensive. Every input already exists on the pre-order row — price, deposit,
 * `balance_paid_at`, `release_date_current` — nothing new is stored.
 *
 * The bar is the **balance still to pay** (price − deposit), booked in the
 * month the piece is due: that's the money that will actually leave the
 * account. A balance already settled, or a cancelled / received order, is not
 * a future outflow and is excluded.
 */
export default function CashflowPlan({ preorders, t, locale }) {
  const dc = useDisplayCurrency();
  const me = useMe();
  const budgetRaw = me.data?.user?.monthly_budget_amount;
  const budgetCurrency = me.data?.user?.monthly_budget_currency;
  const budget =
    budgetRaw == null
      ? null
      : toDisplay(dc.rates, dc.display, Number(budgetRaw), budgetCurrency ?? dc.display);

  const months = useMemo(() => {
    const now = new Date();
    const keys = [];
    const bucket = new Map();
    for (let i = 0; i < MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      keys.push(key);
      bucket.set(key, { key, total: 0, items: [] });
    }

    for (const p of preorders ?? []) {
      if (SETTLED.has(p.status)) continue;
      if (p.balance_paid_at) continue; // already debited
      const date = p.release_date_current ?? p.release_date_original;
      if (!date) continue;
      const key = String(date).slice(0, 7);
      const slot = bucket.get(key);
      if (!slot) continue; // outside the 12-month window

      const price = p.price_amount == null ? null : Number(p.price_amount);
      if (price == null || !Number.isFinite(price)) continue;
      const deposit = p.deposit_amount == null ? 0 : Number(p.deposit_amount);
      const due = Math.max(0, price - deposit);
      const converted = toDisplay(dc.rates, dc.display, due, p.price_currency ?? dc.display);
      if (converted == null) continue;
      slot.total += converted;
      slot.items.push(p.figure_name);
    }
    return keys.map((k) => bucket.get(k));
  }, [preorders, dc.rates, dc.display]);

  const peak = Math.max(1, ...months.map((m) => m.total));
  const anything = months.some((m) => m.total > 0);
  if (!anything) return null;

  const overBudget = budget != null ? months.filter((m) => m.total > budget).length : 0;

  return (
    <section
      className="mt-8 border border-[var(--border)] bg-[var(--surface)] p-5"
      style={{ borderRadius: "var(--radius-lg)" }}
      aria-labelledby="cashflow-title"
    >
      <p className="micro">{t("cashflow.kicker", { default: "財 · TRÉSORERIE" })}</p>
      <h2 id="cashflow-title" className="display text-xl mt-1 text-[var(--color-ivoire)]">
        {t("cashflow.title", { default: "Ce qu'il reste à débourser, mois par mois" })}
      </h2>
      <div className="gold-rule mt-2 mb-4 w-14 opacity-70" />

      {budget != null && overBudget > 0 ? (
        <p className="mb-3 text-sm text-[var(--color-laque-bright)]">
          {t("cashflow.over", {
            n: overBudget,
            default: `${overBudget} mois au-dessus de ton plafond.`,
          })}
        </p>
      ) : null}

      {/* Bars are a <ul> of labelled rows rather than an SVG chart: it stays
          readable by a screen reader, prints, and needs no chart library. */}
      <ul className="space-y-1.5">
        {months.map((m) => {
          const pct = Math.round((m.total / peak) * 100);
          const over = budget != null && m.total > budget;
          return (
            <li key={m.key} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 micro tabular-nums">
                {monthLabel(m.key, locale)}
              </span>
              <span className="flex-1 h-3 relative overflow-hidden" style={{ background: "color-mix(in oklab, var(--color-or) 8%, transparent)" }}>
                <span
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${pct}%`,
                    background: over ? "var(--color-laque-bright)" : "var(--color-or)",
                  }}
                />
                {budget != null && budget < peak ? (
                  // The ceiling, drawn where it actually falls on the scale.
                  <span
                    className="absolute inset-y-0 w-px bg-[var(--color-ivoire)]/70"
                    style={{ left: `${Math.round((budget / peak) * 100)}%` }}
                    aria-hidden
                  />
                ) : null}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-[var(--color-ivoire-soft)]">
                {m.total > 0 ? <Money amount={m.total} currency={dc.display} /> : "—"}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-[var(--on-surface-subtle)]">
        {t("cashflow.note", {
          default:
            "Solde restant (prix − acompte) imputé au mois de sortie annoncé. Les acomptes déjà versés et les commandes soldées ou annulées sont exclus.",
        })}
      </p>
    </section>
  );
}
