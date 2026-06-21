import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "../../i18n/index.jsx";

/**
 * Hierarchy / back-path for 2+ level pages. `items`: [{ label, to }]; the last
 * item is the current page (no link). Rendered as the .micro kicker line.
 */
export default function Breadcrumbs({ items = [], className = "" }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <nav
      aria-label={t("nav.breadcrumb", { default: "Fil d'Ariane" })}
      className={`micro flex items-center gap-1.5 flex-wrap ${className}`}
    >
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${it.label}-${i}`} className="inline-flex items-center gap-1.5">
            {it.to && !last ? (
              <Link
                to={it.to}
                className="text-[var(--on-surface-muted)] hover:text-[var(--accent)] transition-colors"
              >
                {it.label}
              </Link>
            ) : (
              <span
                aria-current={last ? "page" : undefined}
                className={last ? "text-[var(--on-surface)]" : "text-[var(--on-surface-muted)]"}
              >
                {it.label}
              </span>
            )}
            {!last ? (
              <ChevronRight size={12} aria-hidden className="text-[var(--on-surface-subtle)]" />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
