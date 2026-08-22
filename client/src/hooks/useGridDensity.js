import { useEffect, useState } from "react";
import usePersistedState from "./usePersistedState.js";

/** Plate densities, in display order. `auto` lets the shelf decide. */
export const DENSITIES = ["auto", "comfort", "dense", "contact"];

/** Above this many pieces, `auto` switches from browsing to sorting. */
const AUTO_DENSE_AT = 30;

/**
 * Grid density for a plate of figure cards.
 *
 * Sorting 300 pieces is a different task from admiring 30, so the same grid
 * has to do both: **Confort** (today's 4-up), **Dense** (~7-up, chrome trimmed)
 * and **Planche-contact** (~12-up, covers only) for spotting the duplicate or
 * the missing cover in one sweep.
 *
 * `auto` — the default — picks for you: comfort on a phone or a small shelf,
 * dense once the collection outgrows a couple of screens. An explicit choice
 * always wins and is remembered per screen.
 *
 * Deliberately **not** mirrored into the URL: density is how *you* read a
 * screen, not part of the view you share — a shared filter link shouldn't
 * impose the sender's zoom level on the reader.
 */
export default function useGridDensity(storageKey, count = 0) {
  const [density, setDensity] = usePersistedState(storageKey, "auto");
  const [wide, setWide] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 640,
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 640px)");
    if (!mq) return;
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved =
    density !== "auto"
      ? density
      : !wide || count <= AUTO_DENSE_AT
        ? "comfort"
        : "dense";

  return { density, setDensity, resolved };
}
