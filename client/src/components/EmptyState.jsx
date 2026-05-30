import Reveal from "./motion/Reveal.jsx";

/**
 * One reusable empty / zero-data block (Lot 6). A faint kanji watermark, an
 * eyebrow, a display title, optional body, and a CTA slot — the same anatomy
 * as the hand-rolled empty states it replaces. Pass `compact` for in-table /
 * admin contexts. `hue` tints the wash + glyph (defaults to gold).
 *
 *   <EmptyState kanji="空" eyebrow={t("…")} title={t("…")} body={t("…")}>
 *     <Link to="/figures/new"><Button>…</Button></Link>
 *   </EmptyState>
 */
export default function EmptyState({
  kanji = "空",
  eyebrow,
  title,
  body,
  hue = "var(--color-or)",
  compact = false,
  children,
}) {
  return (
    <Reveal
      as="div"
      y={16}
      className={`fc-empty${compact ? " fc-empty--compact" : ""}`}
      style={{ "--hue": hue }}
      role="status"
    >
      {kanji ? (
        <span className="fc-empty-k ja" aria-hidden>
          {kanji}
        </span>
      ) : null}
      <div className="fc-empty-rel">
        {eyebrow ? <p className="fc-empty-eyebrow">{eyebrow}</p> : null}
        {title ? <h2 className="fc-empty-title">{title}</h2> : null}
        {body ? <p className="fc-empty-body">{body}</p> : null}
        {children ? <div className="fc-empty-cta">{children}</div> : null}
      </div>
    </Reveal>
  );
}
