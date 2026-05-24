import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Thin laque-red strip at the top of the viewport when the browser reports
 * itself offline. The PWA's service worker still serves cached pages, so the
 * user can keep navigating — this just makes the degraded state visible.
 */
export default function OfflineIndicator() {
  const t = useT();
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-laque)] text-[var(--color-ivoire)] text-center py-1.5"
    >
      <span className="text-[10px] uppercase tracking-[0.25em]">
        {t("pwa.offline")}
      </span>
    </div>
  );
}
