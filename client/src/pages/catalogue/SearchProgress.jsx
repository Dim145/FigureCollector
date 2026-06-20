import { useEffect, useState } from "react";

// Staged search loader — shared by the on-device searches (Description, Apparence).
// Each runs in phases: download the AI model (first use only) → embed the query
// locally → query the server → receive the results. A phase only surfaces once
// it has lasted ≥750 ms, so a quick search shows no loader at all and a slow one
// explains itself step by step.

const SEARCH_STAGE_FALLBACK = {
  model: "Téléchargement du modèle d'IA…",
  local: "Traitement local de la demande…",
  server: "Recherche sur le serveur…",
  results: "Réception des résultats…",
};

/**
 * Reveal-on-dwell tracker: returns the ordered list of phases that have each
 * stayed current for ≥750 ms. Stays empty while every phase so far has been
 * quick (so the loader never flashes on a fast search). Resets when the search
 * ends (`active` false) or has no phase yet.
 */
export function useStagedReveal(phase, active) {
  const [revealed, setRevealed] = useState([]);
  useEffect(() => {
    if (!active || !phase) {
      setRevealed((r) => (r.length ? [] : r));
      return undefined;
    }
    const id = setTimeout(() => {
      setRevealed((r) => (r.includes(phase) ? r : [...r, phase]));
    }, 750);
    return () => clearTimeout(id);
  }, [phase, active]);
  return revealed;
}

/**
 * The staged loader itself. `revealed` is the done-trail of slow phases; the
 * live `phase` is always the pulsing head (even before it crosses 750 ms), so
 * the gold diamond and the caption beneath always agree. Flat + GPU-light: jade
 * diamonds for done, a breathing gold one for the current step.
 */
export default function SearchProgress({ phase, revealed, t }) {
  const trail = phase && !revealed.includes(phase) ? [...revealed, phase] : revealed;
  return (
    <div className="py-16 flex flex-col items-center gap-5" role="status" aria-live="polite">
      <ol className="flex items-center" aria-hidden="true">
        {trail.map((s, i) => (
          <li key={s} className="flex items-center">
            {i > 0 && <span className="w-10 h-px bg-[var(--color-or)]/25" />}
            <span
              className={
                s === phase
                  ? "w-2.5 h-2.5 rotate-45 bg-[var(--color-or)] animate-pulse"
                  : "w-2.5 h-2.5 rotate-45 bg-[var(--color-jade)]"
              }
            />
          </li>
        ))}
      </ol>
      <p className="micro text-center text-[var(--color-ivoire-soft)]">
        {t(`browse.search.stage.${phase}`, {
          default: SEARCH_STAGE_FALLBACK[phase] ?? "…",
        })}
      </p>
    </div>
  );
}
