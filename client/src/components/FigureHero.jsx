import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useFigurePhotos } from "../hooks/useFigurePhotos.js";
import { usePhotos } from "../hooks/useProfile.js";
import Lightbox from "./Lightbox.jsx";

/**
 * Shoppable hero gallery for a figure detail page.
 *
 * Sources, in order:
 *   1. catalog photos (shared; primary first)
 *   2. — if the viewer owns the figure — their personal photos, prefixed by
 *        a "Mes photos" separator in the strip
 *   3. — last resort — the figure's `official_image_url`, kept for legacy
 *        AniList-imported records that have no uploaded photo yet
 *
 * Navigation:
 *   - click a thumbnail → swap the main image
 *   - ◀ ▶ overlay buttons + ArrowLeft/ArrowRight keys when the main image
 *     has keyboard focus
 *   - thumbnail strip is horizontally scrollable below the main image so the
 *     "boutique" feel is preserved without claustrophobia on portrait images
 *
 * The component degrades gracefully: zero catalog photos + zero personal
 * photos → it falls back to the placeholder SVG, same as before.
 */
export default function FigureHero({
  figure,
  ownedItemId, // null when the viewer doesn't own this figurine
  figureTypeKanji = "像",
  nsfwBlurClass = "",
}) {
  const t = useT();
  const catalogPhotos = useFigurePhotos(figure.id);
  const personalPhotos = usePhotos(ownedItemId);

  // Build a flat list of slides with metadata. Catalog photos first
  // (primary leads), then personal photos, then the legacy URL.
  const slides = useMemo(() => {
    const out = [];
    const catalog = catalogPhotos.data ?? [];
    catalog
      .slice()
      .sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return (a.position ?? 0) - (b.position ?? 0);
      })
      .forEach((p) =>
        out.push({
          key: `cat-${p.id}`,
          url: `/api/figure-photos/${p.id}`,
          kind: "catalog",
          is_primary: p.is_primary,
        }),
      );

    if (ownedItemId) {
      const personal = personalPhotos.data ?? [];
      personal.forEach((p) =>
        out.push({
          key: `mine-${p.id}`,
          url: `/api/photos/${p.id}`,
          kind: "mine",
          is_primary: false,
        }),
      );
    }

    if (out.length === 0 && figure.official_image_url) {
      out.push({
        key: "legacy",
        url: figure.official_image_url,
        kind: "legacy",
        is_primary: true,
      });
    }
    return out;
  }, [catalogPhotos.data, personalPhotos.data, ownedItemId, figure.official_image_url]);

  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Reset when the slide set itself changes (e.g. user uploads a new photo).
  // Snap to the catalog primary if no choice was made yet.
  useEffect(() => {
    if (active >= slides.length) setActive(0);
  }, [slides.length, active]);

  // Shape for the shared Lightbox component — keeps the alt text + URL
  // aligned with what we already render in the well.
  const lightboxSlides = useMemo(
    () =>
      slides.map((s, i) => ({
        src: s.url,
        alt: i === 0 ? figure.name : `${figure.name} — ${i + 1}`,
      })),
    [slides, figure.name],
  );

  const go = useCallback(
    (delta) => {
      if (slides.length === 0) return;
      setActive((c) => (c + delta + slides.length) % slides.length);
    },
    [slides.length],
  );

  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    }
  };

  const current = slides[active];
  const hasSlides = slides.length > 0;
  const showArrows = slides.length > 1;
  const firstMineIndex = slides.findIndex((s) => s.kind === "mine");
  // `null` (no personal photos) vs valid index (where the divider goes).
  const dividerBefore = firstMineIndex > 0 ? firstMineIndex : null;

  return (
    <div className="flex flex-col gap-4 reveal" style={{ "--i": 0 }}>
      {/* Main image well.
       *
       * Sizing: the parent grid column on desktop is `1.1fr` of a 7xl
       * container, so without a cap the 4:5 aspect-ratio well becomes
       * absurdly tall (~850px) and pushes the rest of the page off-
       * screen. Cap at min(560px, 100% of the column) AND a max-height
       * tied to the viewport. The `aspect-[4/5]` keeps shape; the caps
       * keep it sane.
       */}
      <div
        tabIndex={hasSlides ? 0 : -1}
        onKeyDown={onKeyDown}
        aria-roledescription="carousel"
        aria-label={t("figure.hero.aria")}
        className="relative aspect-[4/5] w-full max-w-[min(560px,100%)] max-h-[78vh] bg-[var(--color-noir-deep)] border border-[var(--color-or)]/25 vignette frame-corners outline-none focus-visible:border-[var(--color-or)]/80 mx-auto lg:mx-0"
        style={{
          boxShadow:
            "0 60px 120px -50px rgba(0,0,0,0.9), inset 0 1px 0 oklch(0.92 0.03 75 / 0.06)",
        }}
      >
        {/* Ambient kanji backdrop */}
        <span
          aria-hidden
          className="absolute right-3 bottom-1 ja text-[10rem] leading-none text-[var(--color-or)]/8 select-none pointer-events-none"
        >
          {figureTypeKanji}
        </span>

        {hasSlides ? (
          <>
            {/* Crossfade-style stack — keeps decoded copies of every slide in
                memory so navigation is instant.
                Wrapped in a single button so a click on the active image
                opens the shared Lightbox at the current slide. The button
                fills the well so the entire image area is the hit target. */}
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={t("photos.view")}
              className="absolute inset-0 w-full h-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-or)]/70"
            >
              {slides.map((s, i) => (
                <img
                  key={s.key}
                  src={s.url}
                  // The hero IS the product. SR users need an alt that
                  // identifies the figurine — empty alt previously hid the
                  // entire main image from anyone not using sighted vision.
                  alt={i === 0 ? figure.name : `${figure.name} — ${i + 1}`}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                  className={`absolute inset-0 w-full h-full object-contain p-8 transition-opacity duration-500 pointer-events-none ${nsfwBlurClass}`}
                  style={{ opacity: i === active ? 1 : 0 }}
                />
              ))}
            </button>

            {/* Type chip top-left */}
            <span className="chip absolute top-4 left-4 z-10 pointer-events-none">
              {t(`type.${figure.figure_type}`)}
            </span>

            {/* "MINE" badge on top-right when looking at a personal slide */}
            {current?.kind === "mine" ? (
              <span
                className="chip chip--solid absolute top-4 right-4 z-10 pointer-events-none"
                style={{ fontSize: "9px", padding: "0.18em 0.55em" }}
              >
                ★ {t("figure.hero.mine")}
              </span>
            ) : null}

            {/* Catalog number ribbon */}
            <div className="absolute bottom-4 left-4 right-4 flex items-baseline justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-[var(--color-or-pale)]/70 pointer-events-none">
              <span>n° {String(figure.id).slice(0, 8)}</span>
              {figure.jan ? <span>JAN {figure.jan}</span> : null}
            </div>

            {/* Arrows */}
            {showArrows ? (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label={t("photos.prev")}
                  className="tap-target absolute top-1/2 -translate-y-1/2 left-2 border border-[var(--color-or)]/40 bg-[var(--color-noir)]/70 backdrop-blur-sm text-[var(--color-or-pale)] hover:text-[var(--color-or)] hover:border-[var(--color-or)] transition-colors"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label={t("photos.next")}
                  className="tap-target absolute top-1/2 -translate-y-1/2 right-2 border border-[var(--color-or)]/40 bg-[var(--color-noir)]/70 backdrop-blur-sm text-[var(--color-or-pale)] hover:text-[var(--color-or)] hover:border-[var(--color-or)] transition-colors"
                >
                  ›
                </button>
              </>
            ) : null}

            {/* Position dots (only when ≤ 8 slides; falls back to the strip otherwise) */}
            {showArrows && slides.length <= 8 ? (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                {slides.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setActive(i)}
                    aria-label={`Slide ${i + 1}`}
                    aria-current={i === active}
                    className={`w-1.5 h-1.5 rotate-45 transition-all ${
                      i === active
                        ? "bg-[var(--color-or)] scale-125"
                        : "bg-[var(--color-or)]/30 hover:bg-[var(--color-or)]/60"
                    }`}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <FigurePlaceholder />
        )}
      </div>

      {/* Thumbnail strip — only when more than one slide.
       *  Matches the hero's max-width so the strip aligns under the
       *  capped well rather than running the full grid-column width. */}
      {showArrows ? (
        <div className="w-full max-w-[min(560px,100%)] mx-auto lg:mx-0 overflow-x-auto -mx-1 px-1">
          <ul className="flex items-stretch gap-2">
            {slides.map((s, i) => (
              <Thumb
                key={s.key}
                slide={s}
                active={i === active}
                onClick={() => setActive(i)}
                /* If this thumb is the first personal photo, prepend a
                   visual divider into the strip — kept inline so it scrolls
                   together with the thumbs. */
                separatorBefore={dividerBefore === i ? t("figure.hero.mine_label") : null}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <Lightbox
        open={lightboxOpen}
        slides={lightboxSlides}
        index={active}
        onChange={setActive}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Thumb({ slide, active, onClick, separatorBefore }) {
  return (
    <>
      {separatorBefore ? (
        <li
          aria-hidden
          className="shrink-0 flex flex-col items-center justify-center px-2 min-w-0"
        >
          <span className="gold-rule-vertical h-12 opacity-50" />
          <span className="micro-tight whitespace-nowrap mt-2 -rotate-90 origin-center translate-y-3 text-[9px]">
            {separatorBefore}
          </span>
        </li>
      ) : null}
      <li className="shrink-0">
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className={`relative block w-20 h-20 bg-[var(--color-noir-deep)] border-2 transition-all ${
            active
              ? "border-[var(--color-or)]"
              : "border-[var(--color-or)]/15 hover:border-[var(--color-or)]/60"
          }`}
          style={
            active
              ? {
                  boxShadow:
                    "0 0 0 1px var(--color-or), 0 10px 25px -10px rgba(0,0,0,0.6)",
                }
              : undefined
          }
        >
          <img
            src={slide.url}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {slide.is_primary && slide.kind === "catalog" ? (
            <span
              className="absolute top-0.5 left-0.5 chip chip--solid pointer-events-none"
              style={{ fontSize: "7.5px", padding: "0.1em 0.35em" }}
            >
              ★
            </span>
          ) : null}
          {slide.kind === "mine" ? (
            <span
              className="absolute top-0.5 right-0.5 w-2 h-2 bg-[var(--color-or)] rotate-45 pointer-events-none"
              style={{ boxShadow: "0 0 6px var(--color-or)" }}
            />
          ) : null}
        </button>
      </li>
    </>
  );
}

function FigurePlaceholder() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <svg viewBox="0 0 200 280" className="w-1/2 h-1/2 text-[var(--color-or)]/40" aria-hidden>
        <ellipse cx="100" cy="262" rx="60" ry="6" fill="currentColor" />
        <path
          d="M 62 175 Q 100 162 138 175 L 150 250 Q 100 258 50 250 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="100" cy="95" r="50" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M 50 100 Q 50 42 100 36 Q 150 42 150 100 Q 130 70 100 72 Q 70 70 50 100 Z"
          fill="currentColor"
          opacity="0.4"
        />
      </svg>
    </div>
  );
}
