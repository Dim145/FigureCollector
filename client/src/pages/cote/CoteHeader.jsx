import StatCard from "../../components/StatCard.jsx";
import Money from "../../components/Money.jsx";
import { fmtMoney } from "../../lib/money.js";

/**
 * The valuation headline — a four-tile StatCard strip on the shared foundation.
 * The total is the hero (gold tone, value); the plus-value tints by sign
 * (--success gain / --danger loss) and carries the % chip; pieces-cotées and
 * coût d'acquisition round it out. A footnote below reconciles the displayed
 * (converted) total back to its per-currency originals + the FX date, exactly
 * as the old hero did.
 *
 * Pure presentation: every number, the display currency, and the FX flags are
 * resolved in the orchestrator (CotePage) and passed down.
 */
export default function CoteHeader({
  t,
  locale,
  dispCur,
  dispValue,
  dispPaid,
  dispPlus,
  dispPlusPct,
  showFx,
  valuedCount,
  autoCount,
  msrpCount,
  totalCount,
  fx,
  valueBuckets,
}) {
  const gain = dispPlus != null && dispPlus >= 0;

  // Pieces-valued sub-line: how the valuations were sourced (market / MSRP).
  const valuedSub =
    autoCount > 0 || msrpCount > 0
      ? [
          autoCount > 0 ? t("cote.auto_count", { n: autoCount }) : null,
          msrpCount > 0 ? t("cote.msrp_count", { n: msrpCount }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Headline: total estimated value. */}
        <StatCard
          label={t("cote.estimated_total", {
            default: "Valeur estimée de la collection",
          })}
          tone="gold"
          value={
            dispValue != null ? (
              <Money
                amount={dispValue}
                currency={dispCur}
                round
                approx={showFx ? true : undefined}
              />
            ) : (
              "—"
            )
          }
        />

        {/* Plus-value — sign-tinted (success / danger), with the % chip. */}
        <StatCard
          label={t("cote.plus_value", { default: "Plus-value latente" })}
          value={
            dispPlus != null && dispCur ? (
              <span
                className="inline-flex items-baseline gap-2"
                style={{ color: gain ? "var(--success)" : "var(--danger)" }}
              >
                <span>
                  {gain ? "+" : "−"}
                  <Money
                    amount={Math.abs(dispPlus)}
                    currency={dispCur}
                    round={showFx}
                    approx={showFx ? true : undefined}
                  />
                </span>
                {dispPlusPct != null ? (
                  <span
                    className="text-[11px] font-mono px-1.5 py-0.5 leading-none rounded-[var(--radius-pill)]"
                    style={{
                      color: gain ? "var(--success)" : "var(--danger)",
                      background: gain ? "var(--success-surface)" : "var(--danger-surface)",
                    }}
                  >
                    {gain ? "+" : ""}
                    {dispPlusPct.toFixed(1)} %
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-base text-[var(--on-surface-muted)]">
                {t("cote.no_paid", { default: "Aucun prix saisi" })}
              </span>
            )
          }
        />

        {/* Pieces cotées (valued / total) + how they were sourced. */}
        <StatCard
          label={t("cote.pieces_valued", { default: "Pièces évaluées" })}
          value={
            <span>
              {valuedCount}
              <span className="text-[var(--on-surface-muted)] text-base"> / {totalCount}</span>
            </span>
          }
          sub={valuedSub}
        />

        {/* Coût d'acquisition (total paid). */}
        <StatCard
          label={t("cote.total_paid", { default: "Coût d'acquisition" })}
          value={
            dispPaid != null ? (
              <Money
                amount={dispPaid}
                currency={dispCur}
                round={showFx}
                approx={showFx ? true : undefined}
              />
            ) : (
              "—"
            )
          }
        />
      </div>

      {/* FX reconciliation footnote — only when a conversion is in play. */}
      {showFx ? (
        <p className="mt-3 text-[11px] text-[var(--on-surface-muted)]">
          <span className="uppercase tracking-[0.18em] text-[10px] text-[var(--accent)]">
            {t("fx.approx", { default: "Valeurs approximatives" })}
          </span>
          {fx?.date ? <span className="font-mono"> · {fx.date}</span> : null}
          {fx?.partial ? (
            <span className="text-[var(--danger)]">
              {" · "}
              {t("fx.partial", { default: "conversion partielle" })}
            </span>
          ) : null}
          {valueBuckets?.length ? (
            <span className="block font-mono mt-1 text-[var(--on-surface-subtle)]">
              {valueBuckets.map((b) => fmtMoney(b.estimated_total, b.currency, locale)).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : valueBuckets?.length > 1 ? (
        <p className="mt-3 text-[11px] font-mono text-[var(--on-surface-muted)]">
          {valueBuckets
            .slice(1)
            .map((b) => fmtMoney(b.estimated_total, b.currency, locale))
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
