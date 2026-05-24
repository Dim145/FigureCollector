import { useRegisterSW } from "virtual:pwa-register/react";
import { useT } from "../i18n/index.jsx";

/**
 * Listens to the vite-plugin-pwa lifecycle. When a new service worker has
 * fetched fresh app bytes and is waiting to activate, we show a Direction B
 * toast inviting the user to reload. Until they click "Reload", they keep
 * running the previous version (no surprise refreshes mid-action).
 */
export default function UpdateToast() {
  const t = useT();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // eslint-disable-next-line no-console
      console.warn("[pwa] registration error", error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-sm"
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
