import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useT } from "../i18n/index.jsx";

/**
 * Listens to the vite-plugin-pwa lifecycle. When a new service worker has
 * fetched fresh app bytes and is waiting to activate, we apply it at the next
 * SAFE break — a route change — so the user never gets a surprise refresh
 * mid-action, but also never gets stranded on a stale bundle (the old
 * behaviour: a toast they could ignore forever, leaving them on yesterday's
 * code). The toast is still shown as a fallback for users who sit on one
 * route, repositioned to bottom-centre so it can't occlude right-aligned
 * controls (the entity move-picker, worker row actions, donut hints).
 */
export default function UpdateToast() {
  const t = useT();
  const location = useLocation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // eslint-disable-next-line no-console
      console.warn("[pwa] registration error", error);
    },
  });

  // Apply a pending update on the first navigation AFTER it was detected.
  // `armedAt` records the route we were on when the update appeared; the
  // first time the path differs, we swap to the fresh SW and reload onto the
  // page the user just asked for.
  const armedAt = useRef(null);
  useEffect(() => {
    if (!needRefresh) {
      armedAt.current = null;
      return;
    }
    if (armedAt.current === null) {
      armedAt.current = location.pathname;
      return;
    }
    if (location.pathname !== armedAt.current) {
      updateServiceWorker(true);
    }
  }, [needRefresh, location.pathname, updateServiceWorker]);

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,24rem)]"
    >
      <div
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-4"
        style={{
          boxShadow: "0 30px 60px -30px rgba(0,0,0,0.8)",
        }}
      >
        <p className="display text-lg text-[var(--color-ivoire)] leading-tight">
          {t("pwa.update.title")}
        </p>
        <p className="mt-2 text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
          {t("pwa.update.body")}
        </p>
        <div className="gold-rule my-3" />
        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
          >
            {t("pwa.update.later")}
          </button>
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="bg-[var(--color-or)] text-[var(--color-noir)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] hover:bg-[var(--color-or-pale)] transition-colors"
          >
            {t("pwa.update.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
