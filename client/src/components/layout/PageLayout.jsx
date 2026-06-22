import AccentTitle from "../AccentTitle.jsx";
import Breadcrumbs from "../ui/Breadcrumbs.jsx";

/**
 * The standard editorial page frame: optional breadcrumbs → .micro kicker →
 * .display h1 (with the signature red AccentTitle first word) → gold-rule, plus
 * a right-aligned toolbar slot and a faint kanji watermark. Replaces the
 * ~35 pages that hand-rolled `<div class="max-w-6xl mx-auto px-6 py-16">` +
 * header. Lives INSIDE <AppShell>'s <main>.
 *
 * Props: kicker, title (string → AccentTitle) | titleNode (custom), kanji
 * (watermark glyph), breadcrumbs ([{label,to}]), toolbar (node, top-right),
 * width "prose" | "standard" | "wide".
 */
const WIDTHS = { prose: "max-w-2xl", standard: "max-w-6xl", wide: "max-w-7xl" };

export default function PageLayout({
  kicker,
  title,
  titleNode,
  kanji,
  breadcrumbs,
  toolbar,
  width = "standard",
  children,
  className = "",
  // Hero top padding. Defaults to the standard editorial breathing room; pages
  // that need the first content closer to the fold (e.g. the catalogue) can
  // pass a tighter clamp.
  padTop = "clamp(2rem, 5vw, 4rem)",
}) {
  // When a page passes no header content (e.g. it renders its own frontispiece),
  // skip the editorial header AND the section gap entirely — otherwise the empty
  // header + gold-rule + section margin leave a big void above the content.
  const hasHeader = !!(kanji || breadcrumbs?.length || kicker || title || titleNode || toolbar);
  return (
    <div
      className={`mx-auto w-full ${WIDTHS[width] ?? WIDTHS.standard} ${className}`}
      style={{
        paddingInline: "var(--space-page-x)",
        paddingTop: padTop,
        paddingBottom: "var(--space-section)",
      }}
    >
      {hasHeader ? (
        <header className="relative">
          {kanji ? (
            <span
              aria-hidden
              className="kanji-mark"
              style={{
                position: "absolute",
                top: "-0.35em",
                right: "-0.1em",
                fontSize: "clamp(5rem, 16vw, 11rem)",
                lineHeight: 1,
                pointerEvents: "none",
                zIndex: 0,
              }}
            >
              {kanji}
            </span>
          ) : null}
          {breadcrumbs?.length ? (
            <Breadcrumbs items={breadcrumbs} className="mb-4 relative z-[1]" />
          ) : null}
          {kicker ? <p className="micro mb-3 relative z-[1]">{kicker}</p> : null}
          {title || titleNode ? (
            <div className="relative z-[1] flex items-start justify-between gap-6 flex-wrap">
              <h1 className="display text-4xl sm:text-5xl leading-[1.05] text-[var(--on-surface)]">
                {titleNode ?? <AccentTitle text={title} />}
              </h1>
              {toolbar ? (
                <div className="flex items-center gap-2 flex-wrap shrink-0">{toolbar}</div>
              ) : null}
            </div>
          ) : null}
          <div className="gold-rule mt-5 relative z-[1]" />
        </header>
      ) : null}
      <div style={{ marginTop: hasHeader ? "var(--space-section)" : 0 }}>{children}</div>
    </div>
  );
}
