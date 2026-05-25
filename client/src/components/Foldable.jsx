import { useId, useState } from "react";
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
 * @param {React.ReactNode} props.children    Body content.
 */
export default function Foldable({
  label,
  eyebrow,
  kanji,
  defaultOpen = true,
  size = "minor",
  children,
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={`foldable foldable--${size} ${open ? "is-open" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
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

      <div id={bodyId} className="foldable-body" role="region">
        {/* The inner wrapper is required so `min-height: 0` + `overflow:
         *  hidden` clip the content while the grid row collapses. */}
        <div className="foldable-content">{children}</div>
      </div>
    </section>
  );
}
