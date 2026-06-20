import Card from "../../components/Card.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { Badge } from "../../components/ui/index.js";
import JournalEntry from "./JournalEntry.jsx";

/**
 * The activity feed as a clean editorial list: events bucketed by calendar day,
 * each day a sticky-feeling header (relative label + full date + a count badge)
 * over a hairline-divided Card of `JournalEntry` rows. Most recent day first.
 *
 * Replaces the heavy gold-spine timeline with the shared Card/Badge chrome on
 * semantic tokens — quieter, more scannable, still Direction A. Staggered enter
 * via `Reveal` (capped, GPU-only, reduced-motion safe).
 */
export default function JournalFeed({ days, actorName, actorAvatar, t }) {
  return (
    <div className="space-y-8">
      {days.map((day, i) => (
        <Reveal
          as="section"
          key={day.key}
          y={16}
          amount={0.15}
          delay={Math.min(i * 0.04, 0.2)}
          aria-label={day.date.full}
        >
          {/* Day header */}
          <header className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
            <h2 className="display text-xl text-[var(--on-surface)] leading-none">
              {day.relative ? (
                <span className="text-[var(--accent)]">{t(day.relative)}</span>
              ) : (
                <span>{day.date.full}</span>
              )}
              {day.relative ? (
                <span className="ml-2 text-sm font-normal text-[var(--on-surface-subtle)] not-italic">
                  {day.date.full}
                </span>
              ) : null}
            </h2>
            <Badge tone="gold">
              {day.events.length}&nbsp;{t("activity.day.events")}
            </Badge>
          </header>

          <Card className="px-4 sm:px-5">
            <ol className="divide-y divide-[var(--border-subtle)]">
              {day.events.map((ev) => (
                <JournalEntry
                  key={ev.id}
                  ev={ev}
                  actorName={actorName}
                  actorAvatar={actorAvatar}
                  t={t}
                />
              ))}
            </ol>
          </Card>
        </Reveal>
      ))}
    </div>
  );
}
