import { useState } from "react";
import { Link } from "react-router-dom";
import Money from "../../components/Money.jsx";
import TrackingChip from "../../components/TrackingChip.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import {
  countdownTone,
  deliveryCountdown,
  deliveryDateLabel,
  formatCountdown,
} from "../../lib/deliveryCountdown.js";
import { countdownInfo, resolveAccent, STATUS_KANJI } from "./preorderConstants.js";
import PreorderEditForm, { PreorderHistory } from "./PreorderEditForm.jsx";

/**
 * One timeline entry: a kanji status seal, the title/maker, a colour-coded
 * countdown badge, a meta line (store · ref · acompte · delivery ETA), and an
 * inline edit form. The seal/spine glow + imminent pulse degrade under
 * prefers-reduced-motion via the .horarium-* CSS hooks. Slip history is
 * collapsed by default and only mounted when expanded.
 */
export default function PreorderEntry({ preorder: p, index = 0, t }) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const countdown = countdownInfo(p.release_date_current, t);
  const slipCount = p.slip_count ?? 0;
  const status = p.status ?? "preordered";
  const imminent = countdown.imminent && status !== "cancelled" && status !== "received";

  // The accent for this lifecycle state, exposed as a single `--accent` custom
  // property the decorative elements below reference. Pure styling.
  const accent = resolveAccent(status, imminent);
  // Stagger the scroll reveal within a month, capped so a long month never
  // leaves the last rows waiting too long.
  const revealDelay = Math.min(index * 0.06, 0.3);

  const variantClasses = [
    status === "cancelled" ? "is-cancelled" : "",
    status === "received" ? "is-received" : "",
    imminent ? "is-imminent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sealVariantClass = [
    status === "received" ? "is-received" : "",
    status === "shipped" ? "is-shipped" : "",
    status === "cancelled" ? "is-cancelled" : "",
    imminent ? "is-imminent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bespoke = status === "received" || status === "cancelled";

  return (
    <Reveal
      as="article"
      delay={revealDelay}
      y={20}
      className={`horarium-entry group ${variantClasses}`}
      style={{
        "--accent": accent,
        // Lift the border toward the lifecycle accent without overriding the
        // variant-specific CSS that follows (the :hover shift still applies).
        borderColor: `color-mix(in oklab, ${accent} 22%, transparent)`,
      }}
    >
      {/* Accent spine — a thin colour-coded bar fused to the entry's left edge.
       *  Widens + brightens on hover (transform/opacity only). Decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] origin-left scale-x-50 opacity-70 transition-[transform,opacity] duration-300 ease-out group-hover:scale-x-100 group-hover:opacity-100 motion-reduce:transition-none"
        style={{
          background: `linear-gradient(180deg, transparent, color-mix(in oklab, ${accent} 60%, transparent) 18%, color-mix(in oklab, ${accent} 38%, transparent) 82%, transparent)`,
        }}
      />
      {/* Hover colour-wash — a faint accent bloom from the seal corner.
       *  Opacity-only transition, disabled under reduced motion. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none motion-reduce:group-hover:opacity-0"
        style={{
          background: `radial-gradient(70% 80% at 0% 0%, color-mix(in oklab, ${accent} 12%, transparent), transparent 60%)`,
        }}
      />

      <div className="horarium-entry-head">
        {/* The kanji seal + plain-text status label — the visual anchor. */}
        <div className="horarium-seal-stack">
          <div
            className={`horarium-seal ${sealVariantClass}`}
            aria-label={t(`status.${status}`)}
            title={t(`status.${status}`)}
            style={
              bespoke
                ? undefined
                : {
                    color: accent,
                    borderColor: `color-mix(in oklab, ${accent} 60%, transparent)`,
                    boxShadow: `0 0 16px -6px color-mix(in oklab, ${accent} 75%, transparent)`,
                  }
            }
          >
            {STATUS_KANJI[status] ?? "予"}
          </div>
          <span
            className={`horarium-status-label ${sealVariantClass}`}
            style={
              bespoke
                ? undefined
                : { color: `color-mix(in oklab, ${accent} 85%, var(--color-ivoire-soft))` }
            }
          >
            {t(`status.${status}`)}
          </span>
        </div>

        {/* Body — title + maker */}
        <div className="horarium-entry-body">
          <span className="horarium-entry-kicker">
            {p.figure_type ? t(`type.${p.figure_type}`) : t(`status.${status}`)}
          </span>
          {p.figure_id ? (
            <Link to={`/figures/${p.figure_id}`} className="horarium-entry-title">
              {p.figure_name}
            </Link>
          ) : (
            <span className="horarium-entry-title">{p.figure_name}</span>
          )}
          {p.manufacturer_name ? (
            <span className="horarium-entry-maker">{p.manufacturer_name}</span>
          ) : null}
        </div>

        {/* Right aside — countdown + release date + slip indicator */}
        <div className="horarium-entry-aside">
          <span
            className={`horarium-countdown ${
              countdown.imminent && !countdown.past ? "is-imminent" : ""
            } ${countdown.past ? "is-past" : ""} ${countdown.unknown ? "is-tbc" : ""}`}
            style={
              // Colour-code a live (future, non-TBC) countdown with the
              // entry's accent. Past / TBC keep the muted CSS look.
              !countdown.past && !countdown.unknown
                ? {
                    color: accent,
                    borderColor: `color-mix(in oklab, ${accent} ${imminent ? 70 : 40}%, transparent)`,
                    background: `color-mix(in oklab, ${accent} ${imminent ? 16 : 8}%, transparent)`,
                  }
                : undefined
            }
          >
            {countdown.label}
          </span>
          {p.release_date_current ? (
            <span className="horarium-entry-date">{p.release_date_current}</span>
          ) : null}
          {slipCount === 0 ? (
            <span className="horarium-entry-slip is-zero">{t("preorders.no_slip")}</span>
          ) : (
            <span className="horarium-entry-slip">
              {slipCount === 1
                ? t("preorders.slip_indicator_one")
                : t("preorders.slip_indicator_many", { n: slipCount })}
            </span>
          )}
        </div>
      </div>

      {/* Meta line — store + order ref + deposit + delivery ETA */}
      {p.store_name || p.order_ref || p.deposit_amount ? (
        <div className="horarium-entry-meta">
          {p.store_name ? (
            <span>
              <span className="horarium-entry-meta-key">{t("preorders.field.store")}</span>
              <span className="horarium-entry-meta-value">
                {p.store_slug ? (
                  <Link
                    to={`/catalogue/stores/${p.store_slug}`}
                    className="underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
                  >
                    {p.store_name}
                  </Link>
                ) : (
                  p.store_name
                )}
              </span>
            </span>
          ) : null}
          {p.order_ref ? (
            <span>
              <span className="horarium-entry-meta-key">{t("preorders.field.order_ref")}</span>
              <span className="horarium-entry-meta-value is-mono">{p.order_ref}</span>
            </span>
          ) : null}
          {p.deposit_amount ? (
            <span>
              <span className="horarium-entry-meta-key">{t("preorders.field.deposit")}</span>
              <span className="horarium-entry-meta-value is-mono">
                <Money amount={p.deposit_amount} currency={p.price_currency} />
              </span>
            </span>
          ) : null}
          {/* Delivery countdown — surfaces here too so an overdue parcel is
           *  visible without expanding the entry. */}
          {(() => {
            const days = deliveryCountdown(p);
            if (days == null) return null;
            const date = deliveryDateLabel(p);
            const tip = date ? t("preorder.delivery.tooltip", { date }) : undefined;
            return (
              <span title={tip} className="cursor-help">
                <span className="horarium-entry-meta-key">
                  {t("preorders.field.delivery_chip_label")}
                </span>
                <span className={`horarium-entry-meta-value is-mono ${countdownTone(days)}`}>
                  {formatCountdown(days, t)}
                </span>
              </span>
            );
          })()}
        </div>
      ) : null}

      {/* Original date callout — only when a slip happened */}
      {p.release_date_original && p.release_date_original !== p.release_date_current ? (
        <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70">
          {t("preorders.original_was", { date: p.release_date_original })}
        </p>
      ) : null}

      {p.tracking_url ? (
        <div className="horarium-entry-tracking">
          <TrackingChip url={p.tracking_url} />
        </div>
      ) : null}

      {/* Actions or inline edit form */}
      {editing ? (
        <PreorderEditForm preorder={p} onClose={() => setEditing(false)} t={t} />
      ) : (
        <div className="horarium-entry-actions">
          {slipCount > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryOpen((x) => !x)}
              aria-expanded={historyOpen}
              className="horarium-entry-action"
            >
              {historyOpen ? "−" : "+"} {t("preorders.history_title")}
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(true)} className="horarium-entry-action">
            ✎ {t("preorders.edit")}
          </button>
        </div>
      )}

      {historyOpen ? <PreorderHistory id={p.id} t={t} /> : null}
    </Reveal>
  );
}
