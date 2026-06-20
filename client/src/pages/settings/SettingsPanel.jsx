import Card from "../../components/Card.jsx";

/**
 * One settings section, drawn as a Direction-A {@link Card} with an editorial
 * header (kanji eyebrow → display title → gold-rule) and a faint corner kanji
 * watermark. Generic wrapper composed by every panel on the page.
 *
 * The `id` + `scroll-mt` live on the inner <header> (Card doesn't forward
 * arbitrary DOM ids), so `#id` deep-links, the scroll-spy IntersectionObserver,
 * and `scrollIntoView` all target the same node. `registerRef` wires that node
 * into the orchestrator's ref map.
 *
 * GPU-light: the watermark is a static, pointer-inert glyph — no blur, no
 * animated mesh. Hover/enter transitions only.
 */
export default function SettingsPanel({ id, kanji, eyebrow, title, registerRef, children }) {
  return (
    <Card as="section" className="relative overflow-hidden p-6 md:p-8">
      <span
        aria-hidden
        className="kanji-mark select-none"
        style={{
          position: "absolute",
          top: "-0.4em",
          right: "-0.1em",
          fontSize: "clamp(6rem, 14vw, 11rem)",
          lineHeight: 1,
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        {kanji}
      </span>

      <header
        id={id}
        className="relative mb-6 scroll-mt-28"
        ref={registerRef ? (el) => registerRef(id, el) : undefined}
      >
        <p className="micro flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-base leading-none text-[var(--accent)]">
            {kanji}
          </span>
          {eyebrow}
        </p>
        <h2 className="display text-2xl md:text-3xl mt-2 leading-tight text-[var(--on-surface)]">
          {title}
        </h2>
        <div className="gold-rule w-16 mt-4" />
      </header>

      <div className="relative">{children}</div>
    </Card>
  );
}
