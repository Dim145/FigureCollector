import { useT } from "../i18n/index.jsx";
import { useMangaLink, useFigureManga } from "../hooks/useMangaLink.js";
import { safeHref } from "../lib/safeUrl.js";

const INDIGO = "var(--color-indigo)";
const INDIGO_BRIGHT = "var(--color-indigo-bright)";

/**
 * 連 — the "in your manga collection" badge on a figure detail page.
 *
 * Given a figureId, asks the backend whether this figure's series is in the
 * linked MangaCollector library. Renders nothing when the user has no link or
 * the series isn't there; otherwise the maquette's `.mlink` card: a progress
 * bar, "vol. owned/total · NN% read", and a guarded "Open ↗" deep-link to the
 * public manga profile.
 */
export default function MangaLinkBadge({ figureId }) {
  const t = useT();
  const link = useMangaLink();
  // The badge only resolves when the linked server is approved (active).
  const active = link.data?.status === "approved";
  const manga = useFigureManga(figureId, active);

  if (!active) return null;
  if (!manga.data?.in_library) return null;

  const { name, read_percent, volumes_owned, volumes } = manga.data;
  const pct = clampPct(read_percent);
  // Open the public profile on the linked instance. safeHref blocks any
  // non-http(s) scheme that a poisoned base_url could carry.
  const base = link.data.server?.base_url;
  const href = base ? safeHref(`${base}/u/${link.data.slug}`) : null;

  return (
    <div
      className="mt-6 inline-flex flex-col gap-2 p-3 max-w-sm"
      style={{
        border: `1px solid color-mix(in oklab, ${INDIGO} 40%, transparent)`,
        background: `color-mix(in oklab, ${INDIGO} 8%, transparent)`,
      }}
    >
      <div
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: INDIGO_BRIGHT }}
      >
        <span aria-hidden>📚</span>
        <span>{t("manga.badge.in_collection")}</span>
      </div>

      {name ? (
        <div className="display text-[1.05rem] text-[var(--color-ivoire)] leading-tight">
          {name}
        </div>
      ) : null}

      {/* Progress bar — width = read_percent. */}
      <div
        className="relative h-[5px] overflow-hidden"
        style={{ background: `color-mix(in oklab, ${INDIGO} 18%, transparent)` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("manga.badge.in_collection")}
      >
        <i
          className="absolute inset-y-0 left-0 not-italic"
          style={{ width: `${pct}%`, background: INDIGO_BRIGHT }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] text-[var(--color-ivoire-soft)]">
        <span>
          {t("manga.badge.progress", {
            owned: volumes_owned ?? 0,
            total: volumes ?? 0,
            pct,
          })}
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.12em] no-underline hover:underline"
            style={{ color: INDIGO_BRIGHT }}
          >
            {t("manga.badge.open")} ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
