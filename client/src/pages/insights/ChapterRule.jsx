import Reveal from "../../components/motion/Reveal.jsx";
import { colorMix } from "./chapterTheme.js";

/**
 * Chapter rule — Roman numeral + label + kanji separator. The accent paints the
 * chapter glyphs + tints the trailing rule, so each section opens in its own
 * light; the label stays gold (via the `.chapter-rule-*` CSS) to keep the
 * spread coherent. `id` lets the jump-nav scroll to this rule.
 *
 * Reuses the shared `.chapter-rule*` classes already in index.css.
 */
export default function ChapterRule({ roman, label, kanji, accent = "var(--color-or)", id }) {
  const tintedLine = `linear-gradient(90deg, transparent, ${colorMix(accent, 55)}, transparent)`;
  return (
    <Reveal
      as="div"
      id={id}
      y={14}
      delay={0.02}
      className="chapter-rule scroll-mt-28"
      role="separator"
      aria-label={label}
    >
      <span className="chapter-rule-roman" style={{ color: accent }}>
        {roman}.
      </span>
      <span className="chapter-rule-line" aria-hidden />
      <span className="chapter-rule-label">{label}</span>
      <span className="chapter-rule-line" aria-hidden style={{ background: tintedLine }} />
      <span className="chapter-rule-kanji" aria-hidden style={{ color: accent }}>
        {kanji}
      </span>
    </Reveal>
  );
}
