import { useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n, useT } from "../i18n/index.jsx";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { useCoverImage } from "../hooks/useCoverImage.js";
import { typeHue } from "../lib/typeHue.js";
import { Tooltip } from "./ui/index.js";
import StockBadge from "./StockBadge.jsx";
import { withCoverTransition } from "../hooks/useViewTransition.js";

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
  /** Alternate cover source tried if `imageUrl` fails to load (e.g. the
   *  external official image when the proxied photo times out). */
  imageFallback,
  scale,
  versionName,
  badge,
  href,
  /** Viewer already owns this figure (shows the gold seal). */
  owned = false,
  /** Viewer has wished this figure (shows the laque heart). */
  wished = false,
  /** When true, applies a CSS blur on the cover image (NSFW + viewer pref=blur). */
  blurImage = false,
  /** Per-shop stock for this figure at the current store ("in_stock" |
   *  "out_of_stock" | "preorder"). Only set on the shop page; unknown/absent
   *  renders no badge. */
  stockStatus,
}) {
  const t = useT();
  const { locale } = useI18n();
  const figureTypes = useFigureTypes();
  // Resolve kanji + label for this figure's type via the admin-curated
  // registry so custom types added after build-time render correctly.
  // Falls back to the hard-coded mapping if the lookup hasn't responded
  // (cached across cards via React Query's queryKey dedupe).
  const typeMeta = useMemo(() => {
    const id = type ?? "other";
    const rows = figureTypes.data;
    const match = Array.isArray(rows) ? rows.find((ft) => ft.id === id) : null;
    if (match) {
      return {
        kanji: match.kanji || kanjiFallback(id),
        label: (locale === "fr" ? match.label_fr : match.label_en) || id,
      };
    }
    return { kanji: kanjiFallback(id), label: t(`type.${id}`) };
  }, [figureTypes.data, type, locale, t]);
  const ref = useRef(null);
  // Resilient cover src: on a failed load (CDN rate-limit / transient proxy
  // error — no JS error fires) it retries with a cache-buster, then falls back
  // to the alternate source, then null → placeholder. Fixes catalogue covers
  // that intermittently stay broken until a manual reload.
  const { src: coverSrc, onError: onCoverError } = useCoverImage({
    primary: imageUrl,
    fallback: imageFallback,
  });

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  };

  // The brass type plaque. When a status stamp shares the row it's kanji-only
  // (the romaji is sr-only), so a sighted user can't read the type — wrap it in
  // a tooltip surfacing the full type name on hover/focus. The Tooltip portals
  // out of the card, so the rail's overflow can't clip it.
  const typePlaque = (
    <span className={`label-plaque min-w-0 ${badge ? "is-solo" : ""}`}>
      <span className="label-plaque-kanji" aria-hidden>
        {typeMeta.kanji}
      </span>
      <span className={`min-w-0 ${badge ? "sr-only" : "truncate"}`}>{typeMeta.label}</span>
    </span>
  );

  // The clicked cover is the morph source for the card → detail view
  // transition; the name is applied to it only while the navigation runs.
  const coverRef = useRef(null);
  const navigate = useNavigate();

  const inner = (
    <div
      ref={ref}
      onMouseMove={onMove}
      className="fc-card relative spotlight bg-[var(--color-noir-soft)] h-full flex flex-col"
      style={{ "--hue": typeHue(type) }}
    >
      {/* Type-hue accent bar at the very top edge — each specimen's spotlight,
          visible at rest so the catalogue reads as a band of colour. */}
      <span
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px] z-[4] opacity-70 group-hover/card:opacity-100 transition-opacity duration-500"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--hue) 28%, var(--hue) 72%, transparent)",
        }}
      />
      {/* Photo well — stage-lit specimen surface.
       *
       * Visual layering (back → front):
       *   1. Blurred backdrop copy of the image (object-cover, scaled +
       *      blurred). Fills the letterbox bars that landscape figure
       *      photos leave when contained in a 4:5 portrait well —
       *      previously those bars were stark dark voids, making cards
       *      look half-empty next to portrait figures that filled the
       *      well. The backdrop tints the bars with ambient color from
       *      the figure itself (Spotify-style cover treatment).
       *   2. Ambient kanji watermark (decorative).
       *   3. The sharp `object-contain` figure photo — never cropped.
       *   4. Brass plaque / status stamp / inscription chrome.
       *
       * The two img elements share the same URL → browser dedupes the
       * network request.
       */}
      <div className="specimen-well relative aspect-[4/5] overflow-hidden">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            onError={onCoverError}
            className={`absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-45 pointer-events-none z-0 ${blurImage ? "nsfw-blur" : ""}`}
          />
        ) : null}

        {/* Ambient kanji watermark — fades in on hover */}
        <span
          aria-hidden
          className="fc-kanji ja absolute right-2 bottom-8 text-[7rem] leading-none text-transparent transition-colors duration-700 select-none pointer-events-none z-[1]"
        >
          {typeMeta.kanji}
        </span>

        {coverSrc ? (
          <img
            ref={coverRef}
            src={coverSrc}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={onCoverError}
            className={`absolute inset-0 w-full h-full object-contain p-3 transition-transform duration-700 ease-[var(--ease-curtain)] group-hover/card:scale-[1.04] z-[2] ${blurImage ? "nsfw-blur" : ""}`}
          />
        ) : (
          <FigurePlaceholder />
        )}

        {/* Top bar — the brass type plaque (left) and a SINGLE status element
         *  (right) share one flex row with a gap, so the two can never collide
         *  on a narrow card: the plaque truncates its label (the kanji still
         *  identifies the type) before it would reach the stamp. Right-slot
         *  priority: pre-order stamp > owned seal > wished heart — mutually
         *  exclusive (owned/wished enforced server-side). */}
        <div className="absolute top-3 left-3 right-3 z-[3] flex items-start justify-between gap-2">
          {badge ? <Tooltip label={typeMeta.label}>{typePlaque}</Tooltip> : typePlaque}

          {badge ? (
            <StatusStamp badge={badge} />
          ) : owned ? (
            <span
              className="fc-mark fc-mark--owned shrink-0"
              title={t("catalog.mark.owned")}
              aria-label={t("catalog.mark.owned")}
            >
              ✓
            </span>
          ) : wished ? (
            <span
              className="fc-mark fc-mark--wished shrink-0"
              title={t("catalog.mark.wished")}
              aria-label={t("catalog.mark.wished")}
            >
              ♥
            </span>
          ) : null}
        </div>

        {/* Catalogue inscription — sits over a fade-up gradient at the well's foot */}
        <div className="specimen-inscription">
          <span>
            n<sup>o</sup> {String(figureId ?? "").slice(0, 8) || "—"}
          </span>
          {scale ? <span>{scale}</span> : null}
        </div>
      </div>

      {/* Caption */}
      <div className="fc-card-body p-5 flex-1 flex flex-col">
        <h3 className="display text-xl leading-tight text-[var(--color-ivoire)] line-clamp-2 group-hover/card:text-[var(--color-or-pale)] transition-colors">
          {name}
        </h3>

        {/* Gold separator between title and caption — the type hue lives in
            the top accent bar instead. */}
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
        <StockBadge status={stockStatus} className="mt-2.5 self-start" />
      </div>
    </div>
  );

  const to = href ?? `/figures/${figureId}`;
  return href ? (
    <Link
      to={to}
      className="block group/card h-full"
      onClick={(e) => {
        // Leave every "open elsewhere" gesture to the browser: modifier or
        // middle click, or a handler that already opted out.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        e.preventDefault();
        withCoverTransition(coverRef.current, () => navigate(to));
      }}
    >
      {inner}
    </Link>
  ) : (
    <div className="group/card h-full">{inner}</div>
  );
}

function StatusStamp({ badge }) {
  // `badge` is either a string (legacy) or an object { label, tone }
  const label = typeof badge === "string" ? badge : badge.label;
  const tone = typeof badge === "string" ? "default" : badge.tone ?? "default";
  // Sash colour follows the tone: red for preorder/cancelled, gold for
  // imminent (priority signal) and match (similarity %), ivoire for neutral
  // markers like "pinned cover".
  const sashClass =
    tone === "imminent" || tone === "match"
      ? "label-stamp--gold"
      : tone === "preorder"
        ? ""
        : tone === "cancelled"
          ? "label-stamp--cancelled"
          : "label-stamp--ivory";
  return (
    <span className={`label-stamp shrink-0 ${sashClass}`}>
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

/** Fallback kanji used while `/figure-types` is loading or when the
 *  registry hasn't been seeded yet. Once the lookup responds the live
 *  data (FigureType.kanji column) takes precedence. */
function kanjiFallback(type) {
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
