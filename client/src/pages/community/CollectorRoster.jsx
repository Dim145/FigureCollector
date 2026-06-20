import CollectorCard from "../../components/CollectorCard.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";

/**
 * The directory grid — a responsive list of exhibition `CollectorCard`s (3-up
 * desktop, 2-up tablet, 1-up phone). Each card carries its own follow action.
 * Staggered enter via the shared `Reveal` (capped, GPU-only). Pure presentation
 * over the page's already-loaded roster.
 */
export default function CollectorRoster({ collectors, nsfwPref, t }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {collectors.map((c, i) => (
        <Reveal as="li" key={c.id} delay={Math.min(i, 7) * 0.05} y={24}>
          <CollectorCard c={c} nsfwPref={nsfwPref} t={t} />
        </Reveal>
      ))}
    </ul>
  );
}

/** Grid of card-shaped ghosts while the roster loads — matches the live grid's
 *  columns so the layout doesn't jump when data lands. */
export function CollectorRosterSkeleton({ count = 6, t }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t("a11y.loading", { default: "Chargement…" })}</span>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-64 w-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
