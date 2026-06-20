import AccentTitle from "../../components/AccentTitle.jsx";

/**
 * The consistent editorial header for an admin section page (Users / Figures /
 * Catalog). These pages render inside AdminLayout's <Outlet/>, *below* the
 * global "Administration" h1 + nav rail — so this is a section header (h2), not
 * a page header, and it deliberately reuses AdminLayout's anatomy:
 *
 *   kicker (◆ · kicker · 漢 · label) → AccentTitle h2 → gold-rule → italic gloss
 *
 * over a faint kanji-mark watermark. An optional `actions` slot (the page's one
 * primary CTA, e.g. "New user") floats top-right on wide viewports and stacks
 * below the title on mobile. All chrome is on the shared semantic tokens
 * (--on-surface / --primary / --accent) so it follows the theme.
 *
 * Props
 *   kanji     : watermark + inline glyph (e.g. "衆")
 *   kicker    : the eyebrow lead phrase (already-localised string)
 *   label     : trailing eyebrow word after the inline glyph
 *   title     : section title (string → AccentTitle red first word)
 *   subtitle  : optional italic gloss under the rule
 *   actions   : optional node (the section's primary CTA), top-right on sm+
 */
export default function AdminSectionHeader({ kanji, kicker, label, title, subtitle, actions }) {
  return (
    <header className="relative mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      {kanji ? (
        <span
          aria-hidden
          className="kanji-mark text-[16rem] -top-20 -right-4 hidden md:block select-none"
        >
          {kanji}
        </span>
      ) : null}

      <div className="relative min-w-0">
        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span aria-hidden className="w-1 h-1 bg-[var(--primary)] rotate-45" />
          {kicker}
          {kanji ? (
            <span aria-hidden className="ja not-italic text-[var(--accent)]">
              {kanji}
            </span>
          ) : null}
          {label}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--on-surface)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={title} />
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        {subtitle ? (
          <p
            className="display-italic text-[var(--accent)] text-base md:text-lg mt-4 max-w-xl reveal"
            style={{ "--i": 3 }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="relative reveal shrink-0" style={{ "--i": 2 }}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
