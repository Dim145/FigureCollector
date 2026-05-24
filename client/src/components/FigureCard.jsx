import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import Card from "./Card.jsx";

/**
 * Direction B figure card — small but dignified. Hover lifts the gold border.
 * Used in collection grids and search results.
 */
export default function FigureCard({
  figureId,
  name,
  type,
  manufacturer,
  imageUrl,
  scale,
  heightMm,
  badge,
  href,
}) {
  const t = useT();

  const content = (
    <Card className="h-full p-5 transition-colors hover:border-[var(--color-or)]/50">
      <div className="aspect-square mb-4 grid place-items-center bg-[var(--color-noir)] overflow-hidden">
        {imageUrl ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : (
          <FigurePlaceholder />
        )}
      </div>

      {badge ? (
        <div className="absolute top-3 right-3">
          <span className="chip-badge">{badge}</span>
        </div>
      ) : null}

      <p className="micro mb-1.5">{t(`type.${type ?? "other"}`)}</p>
      <h3 className="display text-lg leading-tight text-[var(--color-ivoire)] line-clamp-2">
        {name}
      </h3>

      <dl className="mt-3 space-y-1 text-[12px] tracking-wide text-[var(--color-ivoire-soft)]">
        {manufacturer ? (
          <div className="flex justify-between gap-2">
            <dt className="opacity-70">{t("figure.spec.manufacturer")}</dt>
            <dd className="text-right truncate">{manufacturer}</dd>
          </div>
        ) : null}
        {scale ? (
          <div className="flex justify-between gap-2">
            <dt className="opacity-70">{t("figure.spec.scale")}</dt>
            <dd>{scale}</dd>
          </div>
        ) : null}
        {heightMm ? (
          <div className="flex justify-between gap-2">
            <dt className="opacity-70">{t("figure.spec.height")}</dt>
            <dd>{heightMm} mm</dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );

  return href ? (
    <Link to={href ?? `/figures/${figureId}`} className="block group">
      {content}
    </Link>
  ) : (
    content
  );
}

/** A tiny SVG silhouette used when no real photo is uploaded yet. */
function FigurePlaceholder() {
  return (
    <svg viewBox="0 0 120 160" className="w-3/5 h-3/5 opacity-30" aria-hidden>
      <ellipse cx="60" cy="148" rx="36" ry="4" fill="currentColor" />
      <path
        d="M 38 100 Q 60 90 82 100 L 90 145 Q 60 152 30 145 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="60" cy="60" r="30" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M 30 65 Q 30 25 60 20 Q 90 25 90 65 Q 78 45 60 47 Q 42 45 30 65 Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  );
}
