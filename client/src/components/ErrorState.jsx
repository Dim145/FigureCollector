import { useT } from "../i18n/index.jsx";

/**
 * Shared query-failure surface — extracted from FigureDetailPage so every
 * page can stop failing silently: a laque exclamation, the generic error
 * line (plus the underlying message when one exists), and a retry ghost.
 * The caller wraps it in its own AppShell/section.
 */
export default function ErrorState({ error, onRetry }) {
  const t = useT();
  return (
    <div role="alert" className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-laque-bright)]">!</p>
      <h2 className="display text-3xl text-[var(--color-ivoire)] mt-4">
        {t("error.unknown")}
      </h2>
      {error?.message ? (
        <p className="mt-3 text-sm text-[var(--color-ivoire-soft)] italic break-words">
          {error.message}
        </p>
      ) : null}
      <div className="gold-rule mx-auto w-24 my-8" />
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("figure.missing.cta_retry")}
        </button>
      ) : null}
    </div>
  );
}
