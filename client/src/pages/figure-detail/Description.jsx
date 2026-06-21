import { useMemo, useState } from "react";

// =============================================================================
// Description — split a scraped blob into prose + a clean spec grid.
//
// Extracted verbatim from the old FigureHeroPanel so the #identite section can
// reuse the drop-cap lede + parsed spec block without the hero shell. Behaviour
// is unchanged — only the home moved.
// =============================================================================

/** Split a scraped description into free prose + a `key: value` spec block.
 *  Only treated as a spec list when there's a real run of such lines (≥3), so
 *  genuine prose (incl. sentences with a stray colon) is left untouched. */
function parseDescription(text) {
  const raw = text ?? "";
  const specRe = /^([\p{L}][\p{L}\d .()/+&'-]{1,22}):\s*(\S.*?)\s*$/u;
  const prose = [];
  const specs = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(specRe);
    const labelWords = m ? m[1].trim().split(/\s+/).length : 0;
    // A spec row = short label, compact value, value not a full sentence.
    if (m && labelWords <= 4 && m[2].length <= 70 && !/[.!?…]\s*$/.test(m[2])) {
      specs.push([m[1].trim(), m[2].trim()]);
    } else {
      prose.push(trimmed);
    }
  }
  if (specs.length < 3) return { prose: raw, specs: [] };
  return { prose: prose.join("\n"), specs };
}

/** Decide how the description reads as a magazine feature. Scraped dumps are
 *  noisy, so a drop-cap lede is only promoted when the opening line is
 *  genuinely prose; otherwise everything renders as plain body. */
function isLedeWorthy(line) {
  if (!/^\p{L}/u.test(line)) return false; // opens on a letter
  if (line.split(/\s+/).length < 6) return false; // a sentence, not a label
  if (/^.{0,24}[:：]/.test(line)) return false; // "Source:" / "Label: value"
  return true;
}

function splitDescription(prose) {
  const lines = prose
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      if (/^(source|url|lien|link|via|réf|ref)\s*[:：]/i.test(l)) return false;
      const urlLen = (l.match(/https?:\/\/\S+/g) || []).join("").length;
      return urlLen <= l.length * 0.4;
    });
  if (lines.length === 0) return { lede: "", body: "" };
  const first = lines[0];
  if (!isLedeWorthy(first)) return { lede: "", body: lines.join("\n") };
  if (lines.length > 1) return { lede: first, body: lines.slice(1).join("\n") };
  if (first.length <= 240) return { lede: first, body: "" };
  const cut = first.slice(0, 240);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const at = stop > 120 ? stop + 1 : 240;
  return { lede: first.slice(0, at).trim(), body: first.slice(at).trim() };
}

/** Editorial description block — drop-cap lede + parsed key/value specs. */
export default function DescriptionBlock({ text, t }) {
  const [expanded, setExpanded] = useState(false);
  const { prose, specs } = useMemo(() => parseDescription(text), [text]);
  const { lede, body } = useMemo(() => splitDescription(prose), [prose]);
  // A lede only exists when the opening line is prose-worthy → always drop-cap.
  const dropCap = !!lede;

  const isLong = body.length > 240;
  const display = !isLong || expanded ? body : body.slice(0, 220).trimEnd() + "…";

  return (
    <div className="mb-2">
      {/* Editorial lede — italic display + gold drop-cap. `break-words` +
       *  `overflow-wrap: anywhere` keep imported descriptions with bare URLs
       *  from overflowing the grid track. */}
      {lede ? (
        <p
          className={`fig-lede break-words [overflow-wrap:anywhere] ${dropCap ? "fig-lede--cap" : ""}`}
        >
          {lede}
        </p>
      ) : null}
      {body ? (
        <p className="text-[var(--color-ivoire-soft)] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {display}
        </p>
      ) : null}
      {body && isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
        >
          {expanded
            ? "− " + t("figure.description.collapse")
            : "+ " + t("figure.description.expand")}
        </button>
      ) : null}

      {/* Spec block parsed out of the scraped dump — a clean key/value grid. */}
      {specs.length > 0 ? (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"
          style={
            prose
              ? {
                  marginTop: "1.25rem",
                  paddingTop: "1.25rem",
                  borderTop: "1px solid color-mix(in oklab, var(--color-or) 18%, transparent)",
                }
              : undefined
          }
        >
          {specs.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="contents">
              <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] py-0.5 whitespace-nowrap">
                {k}
              </dt>
              <dd className="text-[var(--color-ivoire)] py-0.5 break-words [overflow-wrap:anywhere]">
                {/^https?:\/\//.test(v) ? (
                  <a
                    href={v}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] underline underline-offset-2 transition-colors"
                  >
                    {v.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
