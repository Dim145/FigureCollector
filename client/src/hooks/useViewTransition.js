import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";

/** Is the browser able to do a cross-state view transition right now? */
export function canViewTransition() {
  if (typeof document === "undefined" || !document.startViewTransition) return false;
  // Respect the user's motion preference — a morph IS motion.
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Navigate inside a View Transition so a grid cover can morph into the detail
 * hero instead of hard-cutting.
 *
 * React Router is mounted in **declarative** mode here (`<Routes>`), where the
 * `viewTransition` prop does not exist — so we drive the API ourselves.
 * `flushSync` is required: `startViewTransition` snapshots the DOM as soon as
 * its callback returns, and React's default async rendering would hand it the
 * *old* DOM, producing a cross-fade of two identical frames.
 *
 * The page is frozen while the snapshot is taken, so the callback must only
 * navigate — never await data.
 */
export default function useViewTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to, options) => {
      if (!canViewTransition()) {
        navigate(to, options);
        return;
      }
      document.startViewTransition(() => {
        flushSync(() => navigate(to, options));
      });
    },
    [navigate],
  );
}

/**
 * Tag one element as the morph source for the shared `figure-cover` transition,
 * run the navigation, then untag it.
 *
 * `view-transition-name` must be unique in the document, so the name lives on
 * the clicked card only for the duration of the transition — the destination
 * hero carries the same name and the compositor pairs them up.
 */
export function withCoverTransition(el, navigateFn) {
  if (!el || !canViewTransition()) {
    navigateFn();
    return;
  }
  el.classList.add("vt-cover");
  const vt = document.startViewTransition(() => {
    flushSync(() => navigateFn());
  });
  const cleanup = () => el.classList.remove("vt-cover");
  vt.finished.then(cleanup, cleanup);
}
