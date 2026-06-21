import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Collapsible section primitive. Two visual variants share the same
 * machinery:
 *
 *   size="major" — for top-level sections like "La fiche". Italic display
 *                  label + thin gold rule + chevron, mirrors
 *                  `.fig-section-rule` styling.
 *   size="minor" — for owner sub-blocks. Big kanji glyph + display-serif
 *                  title + mono eyebrow, mirrors the previous
 *                  `.fig-owner-block-header` styling.
 *
 * @param {object} props
 * @param {string} props.label                The visible title.
 * @param {string} [props.eyebrow]            Optional mono caption above the
 *                                            title (minor only). Useful for
 *                                            "Ma fiche" / "Album personnel" /
 *                                            …
 * @param {string} [props.kanji]              Single kanji glyph (minor only).
 * @param {boolean} [props.defaultOpen=true]  Initial expansion state.
 * @param {"major"|"minor"} [props.size]      Visual variant.
 * @param {2|3|4|5|6} [props.headingLevel]    When set, the disclosure button is
 *                                            wrapped in an <h2>…<h6> so the
 *                                            collapsible contributes a real
 *                                            heading to the document outline
 *                                            (a disclosure button alone does
 *                                            not). The wrapper is `display:
 *                                            contents` so the header grid layout
 *                                            is untouched. Omitted → unchanged,
 *                                            backward-compatible behaviour.
 * @param {React.ReactNode} props.children    Body content.
 */
export default function Foldable({
  label,
  eyebrow,
  kanji,
  defaultOpen = true,
  size = "minor",
  headingLevel,
  children,
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  // Follow `defaultOpen` until the user manually toggles, so a caller can expand
  // the section once async data resolves (e.g. a scan/3D view exists) without
  // overriding a user who has since collapsed it. No-op while it stays constant.
  const userToggled = useRef(false);
  useEffect(() => {
    if (!userToggled.current) setOpen(defaultOpen);
  }, [defaultOpen]);
  const bodyId = useId();
  const toggle = (
    <button
      type="button"
      onClick={() => {
        userToggled.current = true;
        setOpen((x) => !x);
      }}
      aria-expanded={open}
      aria-controls={bodyId}
      className="foldable-header"
    >
      {kanji ? (
        <span className="foldable-glyph" aria-hidden>
          {kanji}
        </span>
      ) : null}

      <span className="foldable-title">
        {eyebrow ? <span className="foldable-title-sub">{eyebrow}</span> : null}
        <span className="foldable-title-label">{label}</span>
      </span>

      <span className="foldable-rule" aria-hidden />

      <span className="foldable-toggle">
        <span>{open ? t("section.fold") : t("section.unfold")}</span>
        <span className="foldable-chevron" aria-hidden>
          ▾
        </span>
      </span>
    </button>
  );
  // When a heading level is requested, wrap the button in a heading so the
  // collapsible is reachable by heading navigation. `.foldable-heading` is
  // `display: contents`, so the wrapper adds semantics without disturbing the
  // header's grid layout.
  const Heading = headingLevel ? `h${headingLevel}` : null;
  return (
    <section className={`foldable foldable--${size} ${open ? "is-open" : ""}`}>
      {Heading ? <Heading className="foldable-heading">{toggle}</Heading> : toggle}

      <div id={bodyId} className="foldable-body" role="region">
        {/* The inner wrapper is required so `min-height: 0` + `overflow:
         *  hidden` clip the content while the grid row collapses. */}
        <div className="foldable-content">{children}</div>
      </div>
    </section>
  );
}
