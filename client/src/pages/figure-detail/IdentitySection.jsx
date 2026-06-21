import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import FigurePhotosSection from "../../components/FigurePhotosSection.jsx";
import Foldable from "../../components/Foldable.jsx";
import HeadlineSpecs from "./HeadlineSpecs.jsx";

/**
 * #identite — the catalog identity section of ⓪ La Fiche.
 *
 * A 2-column editorial block whose layout adapts to what data exists:
 *
 *   description present → LEFT fills with the editorial drop-cap lede + body
 *                         (its own height drives the block); RIGHT carries the
 *                         "Coup d'œil" summary, Production (作) and the
 *                         complementary parsed-specs.
 *   description empty   → no left column; the summary / production / specs fill
 *                         a single column (no dead space).
 *   both empty          → single column with only the "Coup d'œil" summary, or
 *                         nothing at all if even that is absent.
 *
 * The "Lire la suite" toggle on the description appears ONLY when the prose
 * actually overflows the available block height (measured against the right
 * column with a ResizeObserver) — never a fixed character count.
 *
 * The shared catalogue gallery (FigurePhotosSection) lives here — it is
 * catalogue data, not owner data — collapsed by default when the figure is
 * already owned, expanded otherwise.
 */
export default function IdentitySection({ f, t, canEdit, nsfwPref, galleryDefaultOpen }) {
  const { lede, body, specs } = useMemo(() => parseDescription(f.description), [f.description]);
  const hasDescription = !!(lede || body);

  const productionRows = useMemo(
    () =>
      [
        { label: t("figure.spec.sculptor"), value: f.sculptor_name },
        {
          label: t("figure.spec.materials"),
          value: f.materials?.length ? f.materials.join(" · ") : null,
        },
        { label: t("figure.spec.release"), value: f.release_date },
        { label: t("figure.spec.height"), value: f.height_mm ? `${f.height_mm} mm` : null },
        { label: t("figure.spec.edition"), value: f.edition },
        { label: t("figure.spec.exclusivity"), value: f.exclusivity },
      ].filter((r) => !!r.value),
    [f, t],
  );

  const headlineRows = headlineSpecRows(f, t);
  const hasGlance = headlineRows.length > 0;

  // Dedupe the scraped Compléments against everything already shown as a
  // first-class field (Coup d'œil + Production): a scraper emits "Size:",
  // "Release:", "Scale:", "Version:"… whose values we already print, so drop
  // any spec whose label OR value maps to a structured field — Compléments
  // should carry only residual attributes with no first-class home.
  const dedupedSpecs = useMemo(
    () => dedupeSpecs(specs, f, productionRows, headlineRows),
    [specs, f, productionRows, headlineRows],
  );

  const hasSidecar = hasGlance || productionRows.length > 0 || dedupedSpecs.length > 0;

  // The description is clamped to the sidecar's rendered height (so the left
  // column fills as tall as the right, no taller) — measured live via this ref.
  const sidecarRef = useRef(null);

  // The right-column content, reused whether it sits on the right (description
  // present) or fills a single column (description absent).
  const sidecar = hasSidecar ? (
    <div ref={sidecarRef} className="min-w-0">
      {hasGlance ? (
        <div className="fig-keyspecs">
          <div className="fig-keyspecs-label">
            {t("figure.identity.glance", { default: "Coup d'œil" })}
          </div>
          <HeadlineSpecs f={f} t={t} />
          {/* Catalogue lot reference — moved down from the sticky rail (it is
           *  reference data, not glance-critical). */}
          <div className="mt-4">
            <span className="fig-lot">
              <span className="fig-lot-label">{t("figure.lot.eyebrow")}</span>
              <span className="fig-lot-value">
                Nº{" "}
                {String(f.id ?? "")
                  .slice(0, 8)
                  .toUpperCase()}
              </span>
              <span className="fig-lot-label">{t("figure.lot.kind")}</span>
              <span className="fig-lot-value">{t(`type.${f.figure_type ?? "other"}`)}</span>
            </span>
          </div>
        </div>
      ) : null}

      {productionRows.length > 0 ? (
        <div className="fig-specs-group">
          <div className="fig-specs-group-title">
            <span className="ja" aria-hidden>
              作
            </span>
            {t("figure.cartouche.production")}
          </div>
          <dl className="fig-specs">
            {productionRows.map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {dedupedSpecs.length > 0 ? (
        <div className="fig-specs-group">
          <div className="fig-specs-group-title">
            <span className="ja" aria-hidden>
              録
            </span>
            {t("figure.identity.complementary", { default: "Compléments" })}
          </div>
          <dl className="fig-specs">
            {dedupedSpecs.map(([k, v], i) => (
              <div key={`${k}-${i}`}>
                <dt>{k}</dt>
                <dd>
                  {/^https?:\/\//.test(v) ? (
                    <a
                      href={v}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline underline-offset-2 hover:text-[var(--color-or)] transition-colors"
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
        </div>
      ) : null}
    </div>
  ) : null;

  // ── Layout decision ──────────────────────────────────────────────────────
  // description + sidecar → two columns; one of them → single column; neither →
  // render only the gallery (no empty identity box).
  let identityBody = null;
  if (hasDescription && hasSidecar) {
    identityBody = (
      <div className="fig-id-grid">
        <DescriptionColumn lede={lede} body={body} t={t} clampRef={sidecarRef} />
        {sidecar}
      </div>
    );
  } else if (hasDescription) {
    // Description only → full width, no clamp (no sibling to bound it).
    identityBody = (
      <div className="fig-id-grid fig-id-grid--single">
        <DescriptionColumn lede={lede} body={body} t={t} />
      </div>
    );
  } else if (hasSidecar) {
    identityBody = <div className="fig-id-grid fig-id-grid--single">{sidecar}</div>;
  }

  return (
    <>
      {identityBody}
      <div className={identityBody ? "mt-10" : ""}>
        <Foldable
          size="minor"
          kanji="写"
          label={t("figure.section.gallery", { default: "Galerie catalogue" })}
          defaultOpen={galleryDefaultOpen}
          headingLevel={3}
        >
          <FigurePhotosSection
            figureId={f.id}
            figureName={f.name}
            canEdit={canEdit}
            uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
            blurImages={f.is_nsfw && nsfwPref === "blur"}
          />
        </Foldable>
      </div>
    </>
  );
}

/**
 * The editorial description column. Renders the drop-cap lede + body and shows
 * the "Lire la suite" toggle ONLY when the prose overflows the available height.
 *
 * When `clampRef` (the sibling sidecar) is provided, the column is clamped to
 * the sidecar's live height — measured via a ResizeObserver on the sidecar +
 * the prose — so the description fills as tall as the right column and reveals
 * the toggle exactly when there is more prose than that height allows. With no
 * `clampRef` (single-column layout) the description is never clamped.
 */
function DescriptionColumn({ lede, body, t, clampRef = null }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [clampPx, setClampPx] = useState(null);
  const proseRef = useRef(null);
  const dropCap = !!lede;
  const clampable = !!clampRef;

  // Measure: clamp the prose to the sidecar's height, then decide whether the
  // natural prose exceeds it (→ show "Lire la suite"). Observe ONLY the sidecar
  // — its height drives the clamp. We must NOT observe `prose`: the callback
  // mutates prose's maxHeight, and observing the node you resize is a
  // self-triggering ResizeObserver loop. Prose-content reflow is instead picked
  // up by the [lede, body] dep re-run + the window resize listener. `scrollHeight`
  // is read off prose but ignores its maxHeight, so the comparison is stable.
  useLayoutEffect(() => {
    if (!clampable) {
      setOverflowing(false);
      setClampPx(null);
      return undefined;
    }
    const prose = proseRef.current;
    const side = clampRef.current;
    if (!prose || !side || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const h = side.offsetHeight;
      setClampPx(h > 0 ? h : null);
      // Compare full content height against the clamp height. A small slack
      // avoids a toggle that would reveal a single trailing line.
      setOverflowing(h > 0 && prose.scrollHeight - h > 8);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(side);
    if (typeof window !== "undefined") window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      if (typeof window !== "undefined") window.removeEventListener("resize", measure);
    };
  }, [lede, body, clampable, clampRef]);

  // Collapse back automatically if the content stops overflowing (e.g. viewport
  // widened and everything now fits) so we never strand an "expanded" state.
  useEffect(() => {
    if (!overflowing && expanded) setExpanded(false);
  }, [overflowing, expanded]);

  const doClamp = clampable && !expanded && clampPx != null;

  return (
    <div className="min-w-0">
      <div
        ref={proseRef}
        className={`fig-desc ${doClamp ? "fig-desc--clamp" : ""}`}
        style={doClamp ? { maxHeight: `${clampPx}px` } : undefined}
      >
        {lede ? (
          <p
            className={`fig-lede break-words [overflow-wrap:anywhere] ${dropCap ? "fig-lede--cap" : ""}`}
          >
            {lede}
          </p>
        ) : null}
        {body ? (
          <p className="text-[var(--color-ivoire-soft)] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {body}
          </p>
        ) : null}
      </div>
      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          className="fig-desc-more"
        >
          {expanded
            ? "− " + t("figure.description.collapse")
            : t("figure.description.expand") + " →"}
        </button>
      ) : null}
    </div>
  );
}

// =============================================================================
// Description parsing — split a scraped blob into an editorial lede/body + a
// clean key/value spec list. Mirrors the logic that used to live in
// Description.jsx; kept self-contained here so #identite can place the prose
// (left) and the parsed complementary specs (right) independently.
// =============================================================================

/** Split a scraped description into free prose + a `key: value` spec block.
 *  Only treated as a spec list when there's a real run of such lines (≥3). */
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
    if (m && labelWords <= 4 && m[2].length <= 70 && !/[.!?…]\s*$/.test(m[2])) {
      specs.push([m[1].trim(), m[2].trim()]);
    } else {
      prose.push(trimmed);
    }
  }
  const cleanProse = specs.length < 3 ? raw : prose.join("\n");
  const usableSpecs = specs.length < 3 ? [] : specs;
  const { lede, body } = splitDescription(cleanProse);
  return { lede, body, specs: usableSpecs };
}

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

/** The same four "Coup d'œil" rows HeadlineSpecs renders — duplicated here only
 *  to decide whether the glance card has anything to show (HeadlineSpecs itself
 *  returns null when empty, but we need the count for the layout decision). */
function headlineSpecRows(f, t) {
  return [
    { label: t("figure.spec.manufacturer"), value: f.manufacturer_name },
    { label: t("figure.spec.series"), value: f.series_name },
    { label: t("figure.spec.character"), value: f.character_name },
    { label: t("figure.spec.scale"), value: f.scale },
  ].filter((r) => !!r.value);
}

// Normalize a label/value to a comparison key: lowercase, strip accents, collapse
// non-alphanumerics. Lets "250 mm" match "250mm", "Échelle" match "echelle".
function normKey(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// English/French scraper labels that map onto a first-class field already shown
// in Coup d'œil or Production — any Complément carrying one of these is a dupe.
const REDUNDANT_SPEC_LABELS = new Set(
  [
    "size",
    "height",
    "hauteur",
    "taille",
    "scale",
    "echelle",
    "release",
    "releasedate",
    "sortie",
    "datesortie",
    "estcompletion",
    "completion",
    "version",
    "manufacturer",
    "fabricant",
    "company",
    "series",
    "serie",
    "franchise",
    "character",
    "personnage",
    "sculptor",
    "sculpteur",
    "materials",
    "material",
    "materiau",
    "matiere",
    "edition",
    "exclusive",
    "exclusivity",
    "exclusivite",
    "msrp",
    "price",
    "prix",
    "jan",
    "ean",
    "barcode",
  ].map(normKey),
);

/** Drop scraped Compléments that duplicate a structured field already on the
 *  page (Coup d'œil + Production) — matched by normalized LABEL or VALUE — so
 *  the same "hauteur 250 mm" / "sortie 2027" never prints twice (#20/#21). */
function dedupeSpecs(specs, f, productionRows, headlineRows) {
  if (!specs?.length) return specs ?? [];
  const shownValues = new Set();
  for (const r of [...(productionRows ?? []), ...(headlineRows ?? [])]) {
    const k = normKey(r.value);
    if (k) shownValues.add(k);
  }
  // The raw structured fields too (in case a row wasn't built, e.g. version_name
  // shown only in the rail title, or a height with different formatting).
  for (const v of [
    f.height_mm != null ? `${f.height_mm}mm` : null,
    f.height_mm,
    f.scale,
    f.version_name,
    f.release_date,
    f.edition,
    f.exclusivity,
    f.manufacturer_name,
    f.series_name,
    f.character_name,
    f.sculptor_name,
  ]) {
    const k = normKey(v);
    if (k) shownValues.add(k);
  }
  return specs.filter(([label, value]) => {
    if (REDUNDANT_SPEC_LABELS.has(normKey(label))) return false;
    if (shownValues.has(normKey(value))) return false;
    return true;
  });
}
