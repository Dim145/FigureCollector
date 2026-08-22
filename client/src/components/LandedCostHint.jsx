import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useT } from "../i18n/index.jsx";
import Money from "./Money.jsx";

/**
 * 関 "…and what it really costs once it lands."
 *
 * A ¥24 800 pre-order is not ¥24 800 for a European buyer: import VAT, duty and
 * the carrier's clearance fee arrive weeks later and can add a third. Every
 * money surface in the app reasons on the pre-import price, so this puts the
 * landed figure next to the sticker one.
 *
 * The destination is taken from the instance's own rule table rather than a new
 * per-user setting: a self-hosted collector configures the country they import
 * into, and inventing a second place to say it would just be a second thing to
 * get wrong. With several destinations configured we stay silent rather than
 * guess which one applies.
 *
 * Always labelled as an estimate — this is an operator-maintained table, not a
 * customs ruling.
 */
export default function LandedCostHint({ amount, currency, className = "" }) {
  const t = useT();

  const rules = useQuery({
    queryKey: ["landed-cost", "rules"],
    queryFn: () => api.get("/landed-cost/rules"),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const destinations = Object.keys(rules.data?.destinations ?? {});
  const destination = destinations.length === 1 ? destinations[0] : null;
  const enabled = destination != null && amount != null && Number(amount) > 0;

  const quote = useQuery({
    queryKey: ["landed-cost", destination, currency, String(amount)],
    queryFn: () =>
      api.post("/landed-cost", {
        goods: Number(amount),
        shipping: 0,
        currency: currency ?? "EUR",
        destination,
        items: 1,
      }),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const b = quote.data;
  if (!b) return null;

  return (
    <p className={`text-[10px] tracking-[0.1em] text-[var(--on-surface-muted)] ${className}`}>
      <abbr
        title={t("landed.detail", {
          duty: b.duty,
          vat: b.vat,
          handling: b.handling,
          default: `Droits ${b.duty} · TVA ${b.vat} · frais ${b.handling}`,
        })}
        style={{ textDecoration: "none", borderBottom: "1px dotted currentColor" }}
      >
        {t("landed.label", { default: "≈ rendu" })}
      </abbr>{" "}
      <Money amount={Number(b.total)} currency={b.currency} />
      <span className="opacity-60">
        {" "}
        ({t("landed.estimate", { default: "estimation" })})
      </span>
    </p>
  );
}
