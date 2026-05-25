import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Listens to `fc:achievements-unlocked` events fired by `wsClient.js` and
 * stacks a Direction-B card per newly granted seal. Each entry has its
 * own 6 s dismiss timer so rapid back-to-back unlocks don't reset the
 * window of items already on screen.
 */
export default function AchievementCeremony() {
  const t = useT();
  const [stack, setStack] = useState([]);
  // Stable, monotonically-increasing key. Previously used
  // `${code}-${Date.now()}` which collided when two grants for the same
  // code arrived in the same ms (e.g. burst-grants on first login),
  // producing duplicate React keys and a "list-children-need-keys"
  // warning at runtime.
  const seqRef = useRef(0);

  useEffect(() => {
    const onUnlock = (e) => {
      const codes = Array.isArray(e.detail) ? e.detail : [];
      if (codes.length === 0) return;
      setStack((cur) => [
        ...cur,
        ...codes.map((code) => ({
          id: `${code}-${++seqRef.current}`,
          code,
          // Timestamp drives the per-entry timeout in the effect below.
          shownAt: Date.now(),
        })),
      ]);
    };
    window.addEventListener("fc:achievements-unlocked", onUnlock);
    return () => window.removeEventListener("fc:achievements-unlocked", onUnlock);
  }, []);

  // Per-entry dismiss timers. The previous wiring used ONE shared 6 s
  // timer reset on every new push, which meant N rapid unlocks all
  // disappeared together at the same instant rather than rolling off in
  // the order they arrived. Now each entry tracks its own timeout via
  // its id; the effect only schedules ones it hasn't scheduled before.
  const timeoutsRef = useRef(new Map());
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    for (const entry of stack) {
      if (timeouts.has(entry.id)) continue;
      const handle = setTimeout(() => {
        setStack((cur) => cur.filter((it) => it.id !== entry.id));
        timeouts.delete(entry.id);
      }, 6000);
      timeouts.set(entry.id, handle);
    }
    // Don't clear on each effect re-run — the timers belong to specific
    // entries that may still be mid-flight.
    return () => {
      // Only on unmount: drop everything in flight.
      if (stack.length === 0) {
        for (const handle of timeouts.values()) clearTimeout(handle);
        timeouts.clear();
      }
    };
  }, [stack]);

  if (stack.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {stack.map((entry) => (
        <article
          key={entry.id}
          className="pointer-events-auto bg-[var(--color-noir-soft)] border border-[var(--color-or)] p-4 animate-[fc-ach-in_0.4s_ease-out]"
          style={{
            boxShadow:
              "0 30px 60px -30px rgba(0,0,0,0.8), inset 0 0 0 1px oklch(0.78 0.10 80 / 0.22)",
          }}
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="ja text-3xl text-[var(--color-or)] leading-none">
              印
            </span>
            <div className="min-w-0">
              <p className="micro">{t("achievements.ceremony.kicker")}</p>
              <p className="display text-lg text-[var(--color-ivoire)] mt-0.5 leading-tight">
                {t(`achievements.label.${entry.code}`, { default: entry.code })}
              </p>
            </div>
          </div>
        </article>
      ))}

      <style>{`@keyframes fc-ach-in { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }`}</style>
    </div>
  );
}
