import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { api } from "../../lib/api.js";

/** Days → a human span ("10 sem." / "2,5 mois") without a date library. */
function humanDays(d, t) {
  if (d == null) return "—";
  const days = Math.round(d);
  if (days < 21) return t("slip.days", { n: days, default: `${days} j` });
  if (days < 90) return t("slip.weeks", { n: Math.round(days / 7), default: `${Math.round(days / 7)} sem.` });
  return t("slip.months", { n: (days / 30.4).toFixed(1), default: `${(days / 30.4).toFixed(1)} mois` });
}

/**
 * 遅 Radar de glissement — how late this collector's pre-orders actually run,
 * computed from their own journaled date changes.
 *
 * The announced date is a marketing date; the useful one is "what has this
 * maker historically done to me". The P80 is the number to plan around — half
 * the slips are worse than the median, and the eighth decile is where a
 * reasonable buffer sits.
 *
 * Deliberately quiet when there isn't enough history: a median drawn from one
 * slip would be worse than no number at all, so the server withholds per-maker
 * rows below its sample floor and we say so plainly.
 */
export default function SlipRadar({ t }) {
  const q = useQuery({
    queryKey: ["preorders", "slip-stats"],
    queryFn: () => api.get("/me/preorders/slip-stats"),
    staleTime: 30 * 60 * 1000,
  });

  const data = q.data;
  if (!data || !data.overall || data.overall.samples === 0) return null;

  const { overall, by_manufacturer: makers = [], min_samples: min } = data;

  return (
    <section
      className="mt-8 border border-[var(--border)] bg-[var(--surface)] p-5"
      style={{ borderRadius: "var(--radius-lg)" }}
      aria-labelledby="slip-title"
    >
      <p className="micro">{t("slip.kicker", { default: "遅 · GLISSEMENT" })}</p>
      <h2 id="slip-title" className="display text-xl mt-1 text-[var(--color-ivoire)]">
        {t("slip.title", { default: "Ce que tes précommandes glissent vraiment" })}
      </h2>
      <div className="gold-rule mt-2 mb-4 w-14 opacity-70" />

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-sm text-[var(--color-ivoire-soft)]">
          {t("slip.overall", { default: "Médiane" })}{" "}
          <strong className="display text-lg tabular-nums text-[var(--color-or)]">
            {humanDays(overall.median_days, t)}
          </strong>
        </span>
        <span className="text-sm text-[var(--color-ivoire-soft)]">
          {t("slip.p80", { default: "P80 (à prévoir)" })}{" "}
          <strong className="display text-lg tabular-nums text-[var(--color-or)]">
            {humanDays(overall.p80_days, t)}
          </strong>
        </span>
        <span className="micro text-[var(--color-ivoire-soft)] tabular-nums">
          {t("slip.samples", { n: overall.samples, default: `sur ${overall.samples} glissements` })}
        </span>
      </div>

      {makers.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {makers.map((m) => (
            <li
              key={m.manufacturer_id ?? "unknown"}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="truncate text-[var(--color-ivoire)]">
                <TrendingUp size={12} className="inline mr-1.5 opacity-60" aria-hidden />
                {m.manufacturer_name ?? t("slip.unknown_maker", { default: "Fabricant inconnu" })}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--color-ivoire-soft)]">
                {humanDays(m.median_days, t)}
                <span className="opacity-60"> · P80 {humanDays(m.p80_days, t)}</span>
                <span className="opacity-45"> · n={m.samples}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--color-ivoire-soft)]">
          {t("slip.not_enough", {
            n: min,
            default: `Pas encore assez d'historique par fabricant (${min} glissements minimum).`,
          })}
        </p>
      )}
    </section>
  );
}
