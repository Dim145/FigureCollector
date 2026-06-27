import { Check, PackageX, CalendarClock } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { Badge } from "./ui/index.js";

/** The three known per-shop stock states. Anything else ⇒ "unknown", and the
 *  UI then makes no stock claim. */
export const STOCK_KNOWN = new Set(["in_stock", "out_of_stock", "preorder"]);

/** i18n keys for the short stock label — shared by the shop-card badge and the
 *  figure-detail buy list. */
export const STOCK_LABEL = {
  in_stock: "figure.stock.in_stock",
  out_of_stock: "figure.stock.out_of_stock",
  preorder: "figure.stock.preorder",
};

// Badge tone per state (maps to Direction-A's existing hue grammar: jade = ok,
// laque-red = loss, gold = reserve/future).
const BADGE_TONE = {
  in_stock: "success",
  out_of_stock: "danger",
  preorder: "gold",
};

/** Lucide glyph per state — jade check / package-x / calendar-clock. */
export function StockGlyph({ status, size = 11 }) {
  if (status === "in_stock") return <Check size={size} aria-hidden />;
  if (status === "out_of_stock") return <PackageX size={size} aria-hidden />;
  if (status === "preorder") return <CalendarClock size={size} aria-hidden />;
  return null;
}

/**
 * Compact stock badge for figure cards. Renders nothing for an unknown/absent
 * status — we never imply availability we don't have. Icon + text so the state
 * is never conveyed by colour alone (WCAG 1.4.1 Use of Color).
 */
export default function StockBadge({ status, className = "" }) {
  const t = useT();
  if (!STOCK_KNOWN.has(status)) return null;
  return (
    <Badge tone={BADGE_TONE[status]} className={className}>
      <StockGlyph status={status} />
      {t(STOCK_LABEL[status])}
    </Badge>
  );
}
