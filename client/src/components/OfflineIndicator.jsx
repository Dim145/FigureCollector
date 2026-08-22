import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { pendingCount, startOutboxSync } from "../lib/outbox.js";

/**
 * Thin laque-red strip at the top of the viewport when the browser reports
 * itself offline. The PWA's service worker still serves cached pages, so the
 * user can keep navigating — this just makes the degraded state visible.
 *
 * It also owns the outbox lifecycle: mutations made offline are parked in
 * IndexedDB and replayed on reconnect, and the strip reports how many are
 * waiting so "saved" never silently means "lost".
 */
export default function OfflineIndicator() {
  const t = useT();
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const [pending, setPending] = useState(0);

  // Replay the outbox on reconnect, and keep the badge in step with it.
  useEffect(() => {
    const stop = startOutboxSync();
    const refresh = () => pendingCount().then(setPending);
    refresh();
    window.addEventListener("figurecollector:outbox-changed", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      stop();
      window.removeEventListener("figurecollector:outbox-changed", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

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

  // Online with nothing queued is the normal case — say nothing at all.
  if (online && pending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 left-0 right-0 z-50 text-center py-1.5 text-[var(--color-ivoire)] ${online ? "bg-[var(--color-or)]/80" : "bg-[var(--color-laque)]"}`}
    >
      <span className="text-[10px] uppercase tracking-[0.25em]">
        {online
          ? t("pwa.syncing", { n: pending, default: `${pending} modification(s) à synchroniser` })
          : t("pwa.offline")}
        {!online && pending > 0 ? (
          <span className="tabular-nums opacity-80">
            {" · "}
            {t("pwa.queued", { n: pending, default: `${pending} en attente` })}
          </span>
        ) : null}
      </span>
    </div>
  );
}
