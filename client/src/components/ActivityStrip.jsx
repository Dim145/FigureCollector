import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useActivity } from "../hooks/useActivity.js";

/**
 * Last ~5 events in a compact strip — meant for the LandingPage hero when
 * the user is authenticated. Each line is a one-sentence Direction-B vignette.
 */
export default function ActivityStrip({ limit = 5 }) {
  const t = useT();
  const activity = useActivity({ limit });

  if (!activity.data?.length) return null;

  return (
    <section className="max-w-md mx-auto text-left">
      <header className="flex items-baseline justify-between mb-3">
        <h3 className="micro">{t("activity.title")}</h3>
        <Link
          to="/community/activity"
          className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)]"
        >
          {t("activity.see_all")}
        </Link>
      </header>
      <ol className="space-y-2 text-sm">
        {activity.data.map((ev) => (
          <li key={ev.id} className="grid grid-cols-[1fr_auto] items-baseline gap-3">
            <span className="text-[var(--color-ivoire)] leading-snug">{formatEvent(ev, t)}</span>
            <span className="micro shrink-0">{relativeTime(ev.created_at)}</span>
          </li>
        ))}
      </ol>
      <div className="gold-rule mt-3 opacity-30" />
    </section>
  );
}

export function formatEvent(ev, t) {
  const name = ev.payload?.figure_name ?? "—";
  switch (ev.kind) {
    case "owned_added":
      return t("activity.event.owned_added", { name });
    case "owned_removed":
      return t("activity.event.owned_removed", { name });
    case "preorder_created":
      return t("activity.event.preorder_created", { name });
    case "preorder_slipped":
      return t("activity.event.preorder_slipped", {
        name,
        from: ev.payload?.from_date ?? "?",
        to: ev.payload?.to_date ?? "?",
      });
    case "preorder_status_changed":
      return t("activity.event.preorder_status_changed", {
        name,
        from: ev.payload?.from_status ?? "?",
        to: ev.payload?.to_status ?? "?",
      });
    case "preorder_received":
      return t("activity.event.preorder_received", { name });
    default:
      return t("activity.event.fallback", { kind: ev.kind });
  }
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}j`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mois`;
  return `${Math.round(months / 12)} an${months >= 24 ? "s" : ""}`;
}
