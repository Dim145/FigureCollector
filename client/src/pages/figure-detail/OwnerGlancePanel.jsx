import Money from "../../components/Money.jsx";
import {
  useWishlistItems,
  useAddWishlistItem,
  useRemoveWishlistItem,
} from "../../hooks/useWishlist.js";
import { useFigureValuation } from "../../hooks/useFigureValuation.js";

/**
 * Read-only owner "glance" shown in the sticky rail. A TEASER, not a twin of
 * #valeur: ONE line — current value + the ±% delta — with a "détail →" jump to
 * #valeur where the full payé/valeur/gain trio, sparkline and ledger live.
 *
 * The acompte progress is gone from here on purpose: pre-order deposit data has
 * a single home in #preco (PreorderTimeline). The valuation is derived through
 * the shared `useFigureValuation` so the rail and #valeur can't drift.
 *
 * Renders nothing when there's no value to glance at, so a freshly-added,
 * unpriced piece shows no empty strip.
 */
export function OwnerGlance({ f, owned, t, delay = 7 }) {
  const { value, gainPct, up } = useFigureValuation(f, owned);
  if (!value) return null;

  return (
    <a
      href="#valeur"
      className="fig-rail-cote reveal"
      style={{ "--i": delay }}
      aria-label={t("figure.glance.detail_aria", { default: "Voir le détail de la valeur" })}
    >
      <span className="fig-rail-cote-k">
        {t("figure.glance.current_value", { default: "Valeur actuelle" })}
      </span>
      <span className="fig-rail-cote-row">
        <span className="fig-rail-cote-v tabular-nums">
          <Money amount={value.amount} currency={value.currency} />
        </span>
        {gainPct != null ? (
          <span
            className="fig-rail-cote-delta font-mono tabular-nums"
            style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}
          >
            {up ? "▲" : "▼"} {gainPct > 0 ? "+" : ""}
            {gainPct} %
          </span>
        ) : null}
      </span>
      <span className="fig-rail-cote-link" aria-hidden>
        {t("figure.glance.detail", { default: "Détail" })} →
      </span>
    </a>
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
