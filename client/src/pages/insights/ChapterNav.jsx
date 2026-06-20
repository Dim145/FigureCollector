import { useEffect, useRef, useState } from "react";

/**
 * Sticky chapter jump-nav (table of contents) for the almanac.
 *
 * - Desktop: a quiet vertical rail (Roman numeral + label), the active chapter
 *   marked with the hanko-red accent. Sticky under the app header.
 * - Mobile: a horizontal chip row that scrolls inside its own `overflow-x:auto`
 *   well (the page never side-scrolls).
 *
 * Styled entirely with Tailwind arbitrary values + design tokens (no new CSS
 * classes — index.css is owned elsewhere). GPU-light: only colour/opacity
 * transitions.
 *
 * Active-section tracking is a plain scroll listener (the approach the Settings
 * page uses) — robust to anchors that mount late as lazy chapters hydrate.
 * Clicking smooth-scrolls (auto under prefers-reduced-motion). `chapters` =
 * [{ id, roman, label }] for the chapters actually rendered.
 */
export default function ChapterNav({ chapters }) {
  const [active, setActive] = useState(chapters[0]?.id ?? null);
  const chaptersRef = useRef(chapters);

  // Keep the latest chapter list in a ref so the scroll listener (bound once)
  // always reads the current set as lazy chapters mount in. Updated in an
  // effect — never written during render.
  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    function onScroll() {
      const triggerY = window.innerHeight * 0.28;
      let candidate = null;
      for (const c of chaptersRef.current) {
        const el = document.getElementById(c.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= triggerY) candidate = c.id;
      }
      setActive(candidate ?? chaptersRef.current[0]?.id ?? null);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  function go(e, id) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Move focus for keyboard/AT users without yanking the scroll position.
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }

  if (chapters.length < 2) return null;

  return (
    <nav
      aria-label="Chapitres"
      className="sticky top-24 z-[1] mb-2 max-h-[calc(100dvh-8rem)] overflow-y-auto overflow-x-auto"
    >
      <ul className="flex flex-row lg:flex-col gap-1 lg:gap-0.5 whitespace-nowrap lg:whitespace-normal">
        {chapters.map((c) => {
          const isActive = c.id === active;
          return (
            <li key={c.id}>
              <a
                href={`#${c.id}`}
                onClick={(e) => go(e, c.id)}
                aria-current={isActive ? "true" : undefined}
                className={`group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 min-h-[44px] py-2 text-[13px] leading-tight transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                  isActive
                    ? "text-[var(--color-ivoire)] bg-[color-mix(in_oklab,var(--color-or)_6%,transparent)]"
                    : "text-[var(--color-ivoire-soft)]/70 hover:text-[var(--color-ivoire)]"
                }`}
              >
                <span
                  aria-hidden
                  className={`font-mono text-[10px] tracking-[0.18em] tabular-nums shrink-0 transition-colors ${
                    isActive ? "text-[var(--color-laque-bright)]" : "text-[var(--color-or-pale)]/60"
                  }`}
                >
                  {c.roman}
                </span>
                <span className="truncate">{c.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
