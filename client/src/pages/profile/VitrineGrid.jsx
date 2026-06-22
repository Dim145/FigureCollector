import FigureCard from "../../components/FigureCard.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { resolveOwnedCover } from "../../lib/coverUrl.js";

/** The public collection as the refined `FigureCard` grid. Each tile links to
 *  the figure. Cards stagger in via the shared `Reveal` (capped so a big shelf
 *  doesn't cascade forever). Cover = the owner's pinned photo (resolveOwnedCover),
 *  falling back to catalog art — same as the /collection grid. */
export default function VitrineGrid({ entries }) {
  return (
    <ul className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {entries.map((entry, i) => (
        <Reveal as="li" key={entry.owned_id} delay={Math.min(i, 7) * 0.05} y={24}>
          <FigureCard
            figureId={entry.figure_id}
            href={`/figures/${entry.figure_id}`}
            name={entry.figure_name}
            type={entry.figure_type}
            manufacturer={entry.manufacturer_name}
            imageUrl={resolveOwnedCover(entry)}
            scale={entry.scale}
            versionName={entry.version_name}
          />
        </Reveal>
      ))}
    </ul>
  );
}
