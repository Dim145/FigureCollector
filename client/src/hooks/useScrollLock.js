import { useEffect } from "react";

/**
 * Background scroll-lock that FREEZES the page in place while an overlay is open.
 *
 * It locks the real scroller — `<html>` (`document.documentElement`) — with
 * `overflow: hidden`. That keeps the current scroll offset untouched (the
 * element stays scrolled where it was, it just can't scroll further), so there
 * is NO jump on open and NO jump on close, and — crucially — it needs no
 * programmatic scroll restore. The old `body { overflow: hidden }` lock failed
 * twice over: it targeted <body> (this app scrolls on <html>), and the
 * position:fixed + `scrollTo` restore variant is unusable here because
 * programmatic scrolling (`scrollTo`/`scrollTop`) is a no-op on this page.
 *
 * Ref-counted via module-level state so stacked/nested overlays (e.g. a modal
 * opening a confirm dialog) don't fight: only the first lock applies, only the
 * last release removes it. The freed scrollbar gutter is compensated with
 * padding so the page doesn't shift sideways.
 */
let locks = 0;
let savedOverflow = "";
let savedPaddingRight = "";

export function useScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const de = document.documentElement;
    if (locks === 0) {
      const scrollbar = window.innerWidth - de.clientWidth;
      savedOverflow = de.style.overflow;
      savedPaddingRight = de.style.paddingRight;
      de.style.overflow = "hidden";
      if (scrollbar > 0) de.style.paddingRight = `${scrollbar}px`;
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) {
        de.style.overflow = savedOverflow;
        de.style.paddingRight = savedPaddingRight;
      }
    };
  }, [active]);
}
