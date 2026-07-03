import { Link } from "react-router-dom";
import PageSkeleton from "../../components/Skeleton.jsx";

/**
 * The three "not the happy path" surfaces for the figure detail page,
 * extracted out of the orchestrator. All are Direction-A quiet chrome.
 *
 *   FigureDetailLoading — replaces the old bare "…" loader with the shared
 *                         editorial skeleton (kicker / title / gold-rule +
 *                         content ghosts, sweep honours reduced-motion).
 *   FigureMissingState  — 404 fallback with the two ways back.
 *   NsfwInterstitial    — the consent gate when the viewer's NSFW preference
 *                         would otherwise hide the piece.
 */

/** Skeleton placeholder shown while the figure query is in flight. */
export function FigureDetailLoading() {
  // `compact` keeps the top padding aligned with the page's `pt-8` breadcrumb
  // rather than the taller default — the header doesn't render under AppShell
  // here, so we don't want a double gap.
  return <PageSkeleton blocks={3} compact />;
}

/** 404 — the figure id doesn't resolve. Offers the catalogue + the collection. */
export function FigureMissingState({ t, figureId }) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
      <h1 className="display text-3xl text-[var(--color-ivoire)] mt-4">
        {t("figure.missing.title")}
      </h1>
      <p className="mt-3 text-[var(--color-ivoire-soft)] leading-relaxed">
        {t("figure.missing.body")}
      </p>
      {figureId ? (
        <p className="mt-4 font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/60 break-all">
          {figureId}
        </p>
      ) : null}
      <div className="gold-rule mx-auto w-24 my-8" />
      <div className="flex flex-col items-stretch gap-3">
        <Link
          to="/catalogue"
          className="tap-target px-5 py-3 bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-laque-bright)] transition-colors"
        >
          {t("figure.missing.cta_browse")}
        </Link>
        <Link
          to="/collection"
          className="tap-target px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("figure.missing.cta_collection")}
        </Link>
      </div>
    </div>
  );
}

/** NSFW consent gate — shown before the page when the piece is marked NSFW and
 *  the viewer's preference would hide it. Acknowledging reveals the page for
 *  this visit only (state lives in the orchestrator). */
export function NsfwInterstitial({ t, figureId, onAcknowledge }) {
  return (
    <section className="relative max-w-xl mx-auto px-6 py-24 text-center">
      <span
        aria-hidden
        className="kanji-mark text-[18rem] -top-12 left-1/2 -translate-x-1/2 select-none"
      >
        禁
      </span>
      <p className="micro relative">{t("nsfw.gate.eyebrow")}</p>
      <h1 className="display text-4xl text-[var(--color-ivoire)] mt-3 relative">
        {t("nsfw.gate.title")}
      </h1>
      <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {t("nsfw.gate.body")}
      </p>
      {figureId ? (
        <p className="mt-3 font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/50 break-all relative">
          {figureId}
        </p>
      ) : null}
      <div className="ornate-rule mx-auto w-32 my-8 relative">
        <span aria-hidden className="ornate-rule__diamond" />
      </div>
      <div className="flex flex-col items-stretch gap-3 relative">
        <button
          type="button"
          onClick={onAcknowledge}
          className="tap-target px-5 py-3 bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-laque-bright)] transition-colors"
        >
          {t("nsfw.gate.cta_show")}
        </button>
        <Link
          to="/settings#privacy"
          className="tap-target px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("nsfw.gate.cta_settings")}
        </Link>
        <Link
          to="/catalogue"
          className="tap-target px-5 py-3 text-[var(--color-ivoire-soft)] text-[10px] uppercase tracking-[0.22em] hover:text-[var(--color-or)] transition-colors"
        >
          {t("figure.missing.cta_browse")}
        </Link>
      </div>
    </section>
  );
}
