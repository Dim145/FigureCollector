import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.jsx";

/**
 * Sticky anchor index for the figure detail page — the kanji register from the
 * ⓪ La Fiche mockup (目 Identité · 価 Valeur · 予 Pré-commande · 店 Boutiques ·
 * 私 Ma pièce · 巡 360° · 似 Proches).
 *
 * Reuses the scroll-spy machinery proven on the insights almanac's ChapterNav:
 * a single rAF-coalesced scroll/resize listener reads each section's
 * `getBoundingClientRect().top` against a trigger band, and the active link
 * gets `aria-current="page"` + the hanko-red accent. Robust to sections that
 * mount late (similar self-hides, owner blocks appear only when owned).
 *
 * Entries whose section is absent are filtered out by the caller (it only
 * passes the `entries` that are actually rendered). Below 1024px the row turns
 * into a horizontal-scroll chip strip (the page itself never side-scrolls).
 *
 * @param {{ id:string, kanji:string, label:string }[]} entries
 */
export default function FigureAnchorIndex({ entries }) {
  const t = useT();
  const [active, setActive] = useState(entries[0]?.id ?? null);
  const entriesRef = useRef(entries);
  const navRef = useRef(null);

  // Keep the latest entry list in a ref so the listener (bound once) always
  // reads the current set as owner/similar sections mount. Written in an
  // effect — never during render.
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    let frame = 0;
    function compute() {
      frame = 0;
      const triggerY = window.innerHeight * 0.28;
      let candidate = null;
      for (const e of entriesRef.current) {
        const el = document.getElementById(e.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= triggerY) candidate = e.id;
      }
      setActive(candidate ?? entriesRef.current[0]?.id ?? null);
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(compute);
    }
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Keep the active chip centered in the mobile chip strip — scrolling ONLY the
  // nav container horizontally. `scrollIntoView` would scroll every ancestor
  // (incl. the window) vertically; on mobile that fights the page scroll, so
  // each scroll flips `active` → re-scroll → the page is yanked back up. We
  // compute the target scrollLeft from the link's offset within the nav and
  // never touch the window.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const link = nav.querySelector(`[data-anchor="${active}"]`);
    if (!link) return;
    const target = link.offsetLeft - nav.clientWidth / 2 + link.offsetWidth / 2;
    const max = nav.scrollWidth - nav.clientWidth;
    const left = Math.max(0, Math.min(target, max));
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  function go(e, id) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Move focus for keyboard / AT users without yanking the scroll position.
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }

  if (entries.length < 2) return null;

  return (
    <div className="fig-anchor-wrap">
      <nav
        ref={navRef}
        className="fig-anchor-index max-w-7xl mx-auto px-6"
        aria-label={t("figure.anchor.aria", { default: "Sur cette page" })}
      >
        {entries.map((e) => {
          const isActive = e.id === active;
          return (
            <a
              key={e.id}
              href={`#${e.id}`}
              data-anchor={e.id}
              onClick={(ev) => go(ev, e.id)}
              aria-current={isActive ? "page" : undefined}
              // The French word can be visually hidden on ≤640 (kanji-only
              // chips), so carry it as the accessible name regardless.
              aria-label={e.label}
              className={`fig-anchor-link ${isActive ? "is-active" : ""}`}
            >
              <span className="ja" aria-hidden>
                {e.kanji}
              </span>
              <span>{e.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
