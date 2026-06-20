import { Chip } from "../../components/ui/index.js";
import { EVENT_KINDS } from "./journalConstants.js";

/**
 * The event-kind filter row — one selectable `Chip` per kind that actually
 * occurs in the window, each labelled with its kanji + name + live count.
 * Selected (= shown) chips carry the accent; clicking mutes that kind. Kinds
 * with no events are hidden. Wraps; chips meet the ≥44px target via their
 * padding. Controlled by the page (`muted` Set + `onToggle`).
 */
export default function JournalFilters({ countsByKind, muted, onToggle, t }) {
  const present = EVENT_KINDS.filter((k) => (countsByKind.get(k.id) ?? 0) > 0);
  if (present.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t("activity.filter.label", { default: "Filtrer par type d'événement" })}
      className="flex flex-wrap gap-2"
    >
      {present.map((k) => {
        const count = countsByKind.get(k.id) ?? 0;
        const shown = !muted.has(k.id);
        return (
          <Chip
            key={k.id}
            selected={shown}
            onClick={() => onToggle(k.id)}
            title={t(`activity.kind.${k.id}`)}
          >
            <span aria-hidden className="ja not-italic" style={{ color: k.accent }}>
              {k.kanji}
            </span>
            <span>{t(`activity.kind.${k.id}`)}</span>
            <span className="tabular-nums text-[var(--on-surface-subtle)]">{count}</span>
          </Chip>
        );
      })}
    </div>
  );
}
