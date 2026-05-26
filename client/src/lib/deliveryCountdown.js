/**
 * Helpers for the "delivery ETA countdown" shown on shipped preorders.
 *
 * The preorder gets two paired fields when it ships:
 *   - `shipped_at`              auto-set TIMESTAMPTZ on the status='shipped' flip
 *   - `estimated_delivery_days` carrier-provided ETA in days (INTEGER)
 *
 * The projected delivery date = shipped_at::date + estimated_delivery_days.
 *
 * The same daily cron that fires release-date notifications also fires:
 *   - `preorder_delivery_today`   when projected date == today (once per date)
 *   - `preorder_delivery_overdue` when projected date == today - 1 (J+1, fires once)
 */

/**
 * Returns the number of days remaining until the projected delivery date.
 *
 *   null     — `shipped_at` or `estimated_delivery_days` is missing
 *   > 0      — future ("J-3")
 *   0        — today
 *   < 0      — overdue (-2 means 2 days late)
 *
 * Comparison done in UTC at day granularity so timezone drift around
 * midnight doesn't add spurious ±1 to the result.
 */
export function deliveryCountdown(po) {
  if (!po?.shipped_at || po.estimated_delivery_days == null) return null;
  const shipped = new Date(po.shipped_at);
  if (Number.isNaN(shipped.getTime())) return null;
  const target = new Date(shipped);
  target.setUTCDate(target.getUTCDate() + Number(po.estimated_delivery_days));
  const now = new Date();
  const todayMid = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const targetMid = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  return Math.round((targetMid - todayMid) / (24 * 60 * 60 * 1000));
}

/**
 * Render the countdown as the J± label the user expects.
 *   days > 0  → t("preorder.delivery.in", { n })
 *   days = 0  → t("preorder.delivery.today")
 *   days < 0  → t("preorder.delivery.overdue", { n: -days })
 *
 * Accepts the t() function so we keep this file framework-free
 * (the i18n hook is consumed by callers).
 */
export function formatCountdown(days, t) {
  if (days === 0) return t("preorder.delivery.today");
  if (days > 0) return t("preorder.delivery.in", { n: days });
  return t("preorder.delivery.overdue", { n: -days });
}

/** Convenience: the Tailwind classes for the countdown chip tone.
 *  Overdue = laque-red, today = full gold, future = pale gold. */
export function countdownTone(days) {
  if (days == null) return "";
  if (days < 0) return "text-[var(--color-laque-bright)]";
  if (days === 0) return "text-[var(--color-or)]";
  return "text-[var(--color-or-pale)]";
}
