import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Listens to `fc:achievements-unlocked` events fired by `wsClient.js` and
 * stacks a Direction-B card per newly granted seal. Auto-dismisses after 6 s.
 * Stays out of the way otherwise — the actual seal collection lives on
 * `/achievements`.
 */
export default function AchievementCeremony() {
  const t = useT();
  const [stack, setStack] = useState([]);

  useEffect(() => {
    const onUnlock = (e) => {
      const codes = Array.isArray(e.detail) ? e.detail : [];
      if (codes.length === 0) return;
      setStack((cur) => [
        ...cur,
        ...codes.map((code) => ({ id: `${code}-${Date.now()}`, code })),
      ]);
    };
    window.addEventListener("fc:achievements-unlocked", onUnlock);
    return () => window.removeEventListener("fc:achievements-unlocked", onUnlock);
  }, []);

  useEffect(() => {
    if (stack.length === 0) return;
    const id = setTimeout(() => {
      setStack((cur) => cur.slice(1));
    }, 6000);
    return () => clearTimeout(id);
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
