import { useEffect, useRef } from "react";

/**
 * Restore the page scroll position for a screen the user is coming back to.
 *
 * The core loop of this app is *scroll → open a piece → come back*, and coming
 * back to the top of a 300-item grid loses the reader's place entirely. React
 * Router's declarative mode ships no `ScrollRestoration`, so we keep the offset
 * per `key` in `sessionStorage` (per-tab, cleared with the tab — this is
 * ephemeral UI state, not something to persist on the device).
 *
 * `ready` must flip true only once the list has actually rendered, otherwise we
 * would scroll a page that is still one skeleton tall.
 *
 * The restore is a synchronous `scrollTo({ behavior: "instant" })`: a smooth
 * scroll here would animate past the target if the user starts scrolling, and
 * `requestAnimationFrame` is throttled to a standstill in a background tab.
 */
export default function useScrollRestoration(key, ready = true) {
  const storageKey = `fc.scroll:${key}`;
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    let y = 0;
    try {
      y = parseInt(sessionStorage.getItem(storageKey) ?? "0", 10) || 0;
    } catch {
      return;
    }
    if (y > 0) window.scrollTo({ top: y, behavior: "instant" });
  }, [storageKey, ready]);

  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(storageKey, String(Math.round(window.scrollY)));
      } catch {
        /* private mode / quota — losing a scroll offset is not worth throwing */
      }
    };
    // `pagehide` covers the bfcache + tab close; the cleanup covers an SPA
    // navigation away (unmount), which is the case that actually matters here.
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [storageKey]);
}
