import { mixAccent } from "./mixAccent.js";

/**
 * Localized hero colour-wash for the compare spread — hanko-red on the left
 * (your side), gold meeting in the middle (shared pieces), a faint warm fade on
 * the right (their side). Self-contained inline styles; static (no breathe —
 * GPU-light, reduced-motion safe); edges feathered so the gradients fade
 * instead of hard-cutting at the column. Pinned behind the header.
 */
export default function CompareWash() {
  const wrap = {
    position: "absolute",
    top: "-3rem",
    left: "-3rem",
    right: "-3rem",
    height: "44vh",
    pointerEvents: "none",
    zIndex: 0,
    WebkitMaskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
    maskImage: "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
  };
  const base = { position: "absolute", inset: 0 };
  const layerYou = {
    background: `radial-gradient(50% 66% at 14% 6%, ${mixAccent("var(--color-laque)", 16)}, transparent 70%)`,
  };
  const layerCommon = {
    background: `radial-gradient(42% 56% at 50% 0%, ${mixAccent("var(--color-or)", 16)}, transparent 72%)`,
  };
  const layerThem = {
    background: `radial-gradient(50% 66% at 86% 6%, ${mixAccent("var(--color-or-deep)", 12)}, transparent 70%)`,
  };
  return (
    <div aria-hidden style={wrap}>
      <span style={{ ...base, ...layerYou, opacity: 0.85 }} />
      <span style={{ ...base, ...layerCommon, opacity: 0.85 }} />
      <span style={{ ...base, ...layerThem, opacity: 0.85 }} />
    </div>
  );
}
