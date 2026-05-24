import { useRef } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";

/**
 * Display-pedestal card.
 *  - tall photo well (4:5) with vignette + ambient kanji watermark
 *  - type chip floats top-left
 *  - museum-label catalogue number at the bottom of the photo
 *  - body holds the display title + tight metadata row
 *  - hover lifts the whole card, glows the gold border, follows a spotlight
 */
export default function FigureCard({
  figureId, name, type, manufacturer, imageUrl, scale, heightMm, badge, href,
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
      {/* Photo well */}
      <div className="relative aspect-[4/5] bg-[var(--color-noir-deep)] overflow-hidden vignette">
        {/* Ambient kanji watermark — fades in on hover */}
        <span
          aria-hidden
          className="ja absolute right-2 bottom-1 text-[7rem] leading-none text-transparent transition-colors duration-700 select-none pointer-events-none group-hover/card:text-[var(--color-or)]/10"
        >
          {kanjiForType(type)}
        </span>

        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            className={`absolute inset-0 w-full h-full object-contain p-6 transition-transform duration-700 ease-[var(--ease-curtain)] group-hover/card:scale-[1.04] ${blurImage ? "nsfw-blur" : ""}`}
          />
        ) : (
          <FigurePlaceholder />
        )}

        {/* Type chip */}
        <div className="absolute top-3 left-3">
          <span className="chip">{t(`type.${type ?? "other"}`)}</span>
        </div>

        {/* Status badge — could be preorder phase, cover indicator, etc. */}
        {badge ? (
          <div className="absolute top-3 right-3">
            <span
              className={`chip ${
                badge.tone === "preorder"
                  ? "chip--laque"
                  : badge.tone === "imminent"
                    ? "chip--solid"
                    : ""
              }`}
            >
              {typeof badge === "string" ? badge : badge.label}
            </span>
          </div>
        ) : null}

        {/* Museum-label footer over the photo */}
        <div className="absolute bottom-2 left-3 right-3 flex items-baseline justify-between text-[9px] font-mono uppercase tracking-[0.25em] text-[var(--color-or-pale)]/60">
          <span>n° {String(figureId ?? "").slice(0, 8) || "—"}</span>
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
          {scale ? <Row label={t("figure.spec.scale")} value={scale} /> : null}
          {heightMm ? (
            <Row label={t("figure.spec.height")} value={`${heightMm} mm`} />
          ) : null}
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
    <div className="absolute inset-0 grid place-items-center">
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

/** Maps a figure_type to one evocative kanji used as ambient watermark. */
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
