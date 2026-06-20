import { FigureGrid, EmptyResults } from "./CatalogueResults.jsx";
import SearchProgress, { useStagedReveal } from "./SearchProgress.jsx";

// Per-mode copy. semantic = e5 text-match ("Description"); look = SigLIP
// appearance-match ("Apparence"). Defaults live here; the orchestrator's i18n
// keys (browse.search.{kind}_prompt|error) override when translated.
const COPY = {
  semantic: {
    prompt:
      "Cherche par description : un nom, une série, une matière, un mot dans une autre langue.",
    error: "La recherche a échoué — réessaie.",
  },
  look: {
    prompt:
      "Décris l'apparence d'une figurine pour la retrouver — pose, couleur de cheveux, tenue…",
    error: "La recherche a échoué — réessaie.",
  },
};

/**
 * On-device search results (Description / Apparence) — one component for both
 * staged modes. Surfaces each lifecycle state on its own so a model that fails
 * to load reports it independently:
 *
 *   no query → an italic prompt explaining what this mode searches
 *   busy     → the shared staged loader (only once a phase has run ≥750 ms;
 *              a quick search keeps the last results on screen with no flash)
 *   error    → a hanko-red one-liner (the embedding or request failed)
 *   empty    → the shared EmptyState
 *   results  → the figure grid, each card stamped with its "% match" score
 *
 * The query is embedded in-browser, so the first search of a session waits on a
 * one-time model download (surfaced by the loader's "model" phase).
 */
export default function SemanticResults({
  kind = "semantic",
  state,
  hasQuery,
  figures,
  scores,
  ownedIds,
  wishedIds,
  me,
  t,
}) {
  // Reveal-on-dwell: only phases that take ≥750 ms surface in the staged loader.
  const revealed = useStagedReveal(state.phase, state.busy && hasQuery);
  const copy = COPY[kind] ?? COPY.semantic;

  if (!hasQuery) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">
        {t(`browse.search.${kind}_prompt`, { default: copy.prompt })}
      </p>
    );
  }
  if (state.busy) {
    // A phase that ran ≥750 ms → show the staged loader. Otherwise keep the
    // previous results on screen if we have them (no blank flash on a quick
    // re-search); with nothing to show yet, stay quiet rather than flash a
    // "no results" empty state while the search is still running.
    if (revealed.length > 0)
      return <SearchProgress phase={state.phase} revealed={revealed} t={t} />;
    if (figures.length === 0) return null;
  }
  if (state.error) {
    return (
      <p className="text-center text-[var(--color-laque-bright)] py-16">
        {t(`browse.search.${kind}_error`, { default: copy.error })}
      </p>
    );
  }
  if (figures.length === 0) {
    return <EmptyResults t={t} />;
  }
  return (
    <FigureGrid
      figures={figures}
      scores={scores}
      ownedIds={ownedIds}
      wishedIds={wishedIds}
      me={me}
      t={t}
    />
  );
}
