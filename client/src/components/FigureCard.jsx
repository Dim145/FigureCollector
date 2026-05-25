import { useRef } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";

/**
 * Cabinet de curiosités — display-pedestal card.
 *
 * The card is a single specimen mounted in a noir vitrine. The photo well is
 * stage-lit (radial spot upper-left), the type chip is a *brass plaque* with
 * the kanji glyph engraved beside the romaji, and lifecycle status surfaces
 * as a *noir stamp* with a red sash. Both artifacts are opaque + weighty so
 * they stay readable against holographic packaging photos that used to wash
 * out the old hairline chips.
 *
 *  - tall photo well (4:5) with vignette, kanji watermark, paper grain
 *  - .label-plaque  top-left   — type + kanji glyph
 *  - .label-stamp   top-right  — pre-order / cover / imminent
 *  - .specimen-inscription bottom — lot number + scale
 *  - body holds the display title + tight metadata row
 *  - hover lifts the card, glows the gold border, follows a spotlight
 */
export default function FigureCard({
  figureId,
  name,
  type,
  manufacturer,
  imageUrl,
  scale,
  versionName,
  badge,
  href,
  /** When true, applies a CSS blur on the cover image (NSFW + viewer pref=blur). */
  blurImage = false,
}) {
  const t = useT();
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  };

  const inner = (
    <div
      ref={ref}
      onMouseMove={onMove}
      className="relative spotlight card-lift bg-[var(--color-noir-soft)] border border-[var(--color-or)]/20 h-full flex flex-col"
      style={{
        boxShadow:
          "0 25px 60px -30px rgba(0,0,0,0.85), inset 0 1px 0 oklch(0.92 0.03 75 / 0.05)",
      }}
    >
      {/* Photo well — stage-lit specimen surface */}
      <div className="specimen-well relative aspect-[4/5] overflow-hidden">
        {/* Ambient kanji watermark — fades in on hover */}
        <span
          aria-hidden
          className="ja absolute right-2 bottom-8 text-[7rem] leading-none text-transparent transition-colors duration-700 select-none pointer-events-none group-hover/card:text-[var(--color-or)]/12"
        >
          {kanjiForType(type)}
        </span>

        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            className={`absolute inset-0 w-full h-full object-contain p-6 transition-transform duration-700 ease-[var(--ease-curtain)] group-hover/card:scale-[1.04] z-[1] ${blurImage ? "nsfw-blur" : ""}`}
          />
        ) : (
          <FigurePlaceholder />
        )}

        {/* Brass plaque — type with kanji */}
        <div className="absolute top-3 left-3 z-[3]">
          <span className="label-plaque">
            <span className="label-plaque-kanji" aria-hidden>
              {kanjiForType(type)}
            </span>
            <span>{t(`type.${type ?? "other"}`)}</span>
          </span>
        </div>

        {/* Stamp — lifecycle / status, when present */}
        {badge ? (
          <div className="absolute top-3 right-3 z-[3]">
            <StatusStamp badge={badge} />
          </div>
        ) : null}

        {/* Catalogue inscription — sits over a fade-up gradient at the well's foot */}
        <div className="specimen-inscription">
          <span>
            n<sup>o</sup> {String(figureId ?? "").slice(0, 8) || "—"}
          </span>
          {scale ? <span>{scale}</span> : null}
        </div>
      </div>

      {/* Caption */}
      <div className="p-5 flex-1 flex flex-col">
        <h3 className="display text-xl leading-tight text-[var(--color-ivoire)] line-clamp-2 group-hover/card:text-[var(--color-or-pale)] transition-colors">
          {name}
        </h3>

        <div className="gold-rule mt-3 mb-3 w-10 opacity-60" />

        <dl className="text-[11px] tracking-wider text-[var(--color-ivoire-soft)] space-y-1 mt-auto">
          {manufacturer ? (
            <Row label={t("figure.spec.manufacturer")} value={manufacturer} />
          ) : null}
          {versionName ? (
            <Row label={t("figure.spec.version")} value={versionName} />
          ) : null}
          {scale ? <Row label={t("figure.spec.scale")} value={scale} /> : null}
        </dl>
      </div>
    </div>
  );

  return href ? (
    <Link to={href ?? `/figures/${figureId}`} className="block group/card h-full">
      {inner}
    </Link>
  ) : (
    <div className="group/card h-full">{inner}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function StatusStamp({ badge }) {
  // `badge` is either a string (legacy) or an object { label, tone }
  const label = typeof badge === "string" ? badge : badge.label;
  const tone = typeof badge === "string" ? "default" : badge.tone ?? "default";
  // Sash colour follows the tone: red for preorder, gold for imminent (a
  // priority signal), ivoire for neutral markers like "pinned cover".
  const sashClass =
    tone === "imminent"
      ? "label-stamp--gold"
      : tone === "preorder"
        ? ""
        : "label-stamp--ivory";
  return (
    <span className={`label-stamp ${sashClass}`}>
      <span>{label}</span>
    </span>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 items-baseline">
      <dt className="opacity-60 uppercase text-[9.5px] tracking-[0.18em]">{label}</dt>
      <dd className="truncate text-right text-[12px] tracking-tight">{value}</dd>
    </div>
  );
}

function FigurePlaceholder() {
  return (
    <div className="absolute inset-0 grid place-items-center z-[1]">
      <svg
        viewBox="0 0 120 160"
        className="w-1/2 h-1/2 text-[var(--color-or)]/25"
        aria-hidden
      >
        <ellipse cx="60" cy="148" rx="36" ry="4" fill="currentColor" opacity="0.7" />
        <circle cx="60" cy="50" r="20" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M 28 110 Q 60 95 92 110 L 100 140 Q 60 148 20 140 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M 32 60 Q 32 22 60 18 Q 88 22 88 60 Q 75 42 60 44 Q 45 42 32 60 Z"
          fill="currentColor"
          opacity="0.35"
        />
      </svg>
    </div>
  );
}

/** Maps a figure_type to one evocative kanji used as ambient watermark
 *  and engraved on the brass plaque. */
function kanjiForType(type) {
  switch (type) {
    case "nendoroid":  return "童";
    case "scale":      return "像";
    case "figma":      return "動";
    case "prize":      return "賞";
    case "trading":    return "交";
    case "statue":     return "彫";
    case "plamo":      return "組";
    case "bishoujo":   return "美";
    case "dakimakura": return "枕";
    default:           return "玩";
  }
}
