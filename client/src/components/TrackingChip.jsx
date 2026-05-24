import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseTrackingUrl } from "../lib/carrierTracking.js";
import { useT } from "../i18n/index.jsx";
import { api, ApiError } from "../lib/api.js";

/** Carriers we know how to live-fetch via /api/tracking/* on the server. */
const LIVE_TRACKING_CARRIERS = new Set(["colissimo", "dhl", "ups"]);

/**
 * Pretty-render a pasted tracking URL.
 *
 * When the carrier is one of the live-tracking providers (UPS / DHL /
 * Colissimo) **and** the URL contained a recognisable tracking number, we
 * fetch the latest status from our server-side proxy and surface the most
 * recent event description + timestamp + location. The proxy degrades
 * silently (HTTP 403 feature_disabled) when the server doesn't have an
 * API key configured, so the chip falls back to "just a link" without
 * shouting at the user.
 *
 * @param {object} props
 * @param {string|null|undefined} props.url
 * @param {"compact"|"full"} [props.size="full"]
 */
export default function TrackingChip({ url, size = "full" }) {
  const t = useT();
  const parsed = useMemo(() => parseTrackingUrl(url), [url]);

  const canLive =
    !!parsed?.number && LIVE_TRACKING_CARRIERS.has(parsed.id);

  const live = useQuery({
    queryKey: ["tracking", parsed?.id, parsed?.number],
    queryFn: () =>
      api.get(
        `/tracking/${encodeURIComponent(parsed.id)}/${encodeURIComponent(parsed.number)}`,
      ),
    enabled: canLive && size !== "compact",
    // Cache for 5 minutes on the client; the server-side cache adds another
    // 10 minutes minimum on top. Carriers rarely move statuses faster than
    // that anyway.
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => {
      // FeatureDisabled (no API key) → don't retry, it won't change.
      // NotFound (carrier doesn't recognise the number yet — recent label) →
      // also stop retrying for this session, retry on next mount.
      if (
        err instanceof ApiError &&
        (err.code === "feature_disabled" ||
          err.code === "not_found" ||
          err.status === 404)
      ) {
        return false;
      }
      return count < 1;
    },
  });

  if (!parsed) return null;

  if (size === "compact") {
    return (
      <a
        href={parsed.canonicalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors border border-[var(--color-or)]/30 hover:border-[var(--color-or)] px-2.5 py-1"
      >
        <CarrierGlyph id={parsed.id} />
        <span>{parsed.name}</span>
        {parsed.number ? (
          <span className="font-mono normal-case tracking-normal text-[var(--color-ivoire)]/80">
            {truncate(parsed.number, 14)}
          </span>
        ) : null}
        <span aria-hidden>↗</span>
      </a>
    );
  }

  const status = live.data;
  const isDelivered = status?.is_delivered === true;

  return (
    <a
      href={parsed.canonicalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`group/track block border bg-[var(--color-noir)]/40 hover:bg-[var(--color-or)]/5 transition-all p-3 ${
        isDelivered
          ? "border-[var(--color-or)]/60 hover:border-[var(--color-or)]"
          : "border-[var(--color-or)]/25 hover:border-[var(--color-or)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <CarrierGlyph id={parsed.id} size="lg" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/80">
              {parsed.knownCarrier
                ? t("preorders.tracking.carrier")
                : t("preorders.tracking.carrier_unknown")}
            </p>
            <p className="display text-base text-[var(--color-ivoire)] leading-tight truncate">
              {parsed.name}
            </p>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] opacity-60 group-hover/track:opacity-100 group-hover/track:text-[var(--color-or)] transition-colors whitespace-nowrap">
          {t("preorders.tracking.open")} ↗
        </span>
      </div>

      {parsed.number ? (
        <p className="mt-2 font-mono text-xs tracking-wider text-[var(--color-ivoire-soft)] truncate">
          {parsed.number}
        </p>
      ) : null}

      {/* Live status pulled from the carrier API via our proxy */}
      {canLive ? (
        <LiveStatus query={live} status={status} t={t} />
      ) : null}
    </a>
  );
}

/** Inline strip shown under the carrier header when a live API call is
 *  available. Three states:
 *   - loading: subtle "fetching" line
 *   - success: gold-bordered block with description + timestamp + location
 *   - feature-disabled / not-found: silent (no key on the server, or carrier
 *     hasn't picked the number up yet — falling back to the link is fine)
 *   - other error: subtle "couldn't refresh" hint, link still works */
function LiveStatus({ query, status, t }) {
  if (query.isLoading) {
    return (
      <p className="mt-3 pt-3 border-t border-[var(--color-or)]/15 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/60 italic">
        {t("preorders.tracking.fetching")} …
      </p>
    );
  }
  if (query.isError) {
    const code = query.error?.code;
    // Silent on the cases we expect ("feature disabled" + "not found").
    if (code === "feature_disabled" || code === "not_found" || query.error?.status === 404) {
      return null;
    }
    return (
      <p className="mt-3 pt-3 border-t border-[var(--color-or)]/15 text-[10px] uppercase tracking-[0.18em] text-[var(--color-laque-bright)]/80">
        {t("preorders.tracking.refresh_failed")}
      </p>
    );
  }
  if (!status) return null;

  const dt = status.timestamp ? new Date(status.timestamp) : null;
  return (
    <div
      className={`mt-3 pt-3 border-t ${
        status.is_delivered
          ? "border-[var(--color-or)]/40"
          : "border-[var(--color-or)]/15"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={`display text-sm leading-tight ${
            status.is_delivered
              ? "text-[var(--color-or-pale)]"
              : "text-[var(--color-ivoire)]"
          }`}
        >
          {status.is_delivered ? "✓ " : ""}
          {status.status}
        </p>
        {dt ? (
          <time
            dateTime={status.timestamp}
            className="font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/70 whitespace-nowrap shrink-0"
          >
            {formatRelative(dt)}
          </time>
        ) : null}
      </div>
      {status.location ? (
        <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/70">
          {status.location}
        </p>
      ) : null}
    </div>
  );
}

/** "il y a 3 h" / "3h ago" — tiny no-dep formatter. */
function formatRelative(date) {
  const diffSec = (Date.now() - date.getTime()) / 1000;
  if (diffSec < 60) return `${Math.floor(diffSec)}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d`;
  return date.toLocaleDateString();
}

/** Minimal SVG glyph per carrier. Not pixel-perfect logos (those are
 *  trademarked) — just simple monochrome marks in our gold so the chip
 *  feels custom without licensing risk. */
function CarrierGlyph({ id, size = "sm" }) {
  const dim = size === "lg" ? 18 : 12;
  const c = "var(--color-or)";
  const glyph = GLYPHS[id] ?? GLYPHS.unknown;
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 16 16"
      aria-hidden
      className="shrink-0"
      style={{ color: c }}
    >
      {glyph}
    </svg>
  );
}

const GLYPHS = {
  ups: (
    <path
      d="M3 3v6a5 5 0 0 0 10 0V3M5 1l3 2 3-2"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  dhl: (
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
      <path d="M2 6 L10 6 M3 10 L11 10" />
      <path d="M11 4 L14 4 L13 6 L10 6 Z" fill="currentColor" />
    </g>
  ),
  colissimo: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3 V8 L11 10" strokeLinecap="round" />
    </g>
  ),
  chronopost: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
      <path d="M3 8 H13 M9 4 L13 8 L9 12" />
    </g>
  ),
  fedex: (
    <g fill="currentColor" stroke="none">
      <path d="M2 5 H6 V7 H4 V8 H6 V11 H2 Z" />
      <path d="M8 5 H14 L11 11 Z" />
    </g>
  ),
  usps: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <path d="M2 5 L8 9 L14 5" strokeLinecap="round" />
      <rect x="2" y="5" width="12" height="7" />
    </g>
  ),
  mondialrelay: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <rect x="2" y="4" width="12" height="9" />
      <path d="M2 7 L8 10 L14 7" strokeLinecap="round" />
    </g>
  ),
  gls: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
      <circle cx="8" cy="8" r="5" />
      <path d="M5 8 L8 11 L11 5" />
    </g>
  ),
  tnt: (
    <g fill="currentColor" stroke="none">
      <rect x="2" y="3" width="3" height="10" />
      <rect x="6.5" y="3" width="3" height="10" />
      <rect x="11" y="3" width="3" height="10" />
    </g>
  ),
  japanpost: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <circle cx="8" cy="8" r="5" />
      <path d="M5 8 H11 M8 5 V11" strokeLinecap="round" />
    </g>
  ),
  ems: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <path d="M3 5 H8 M3 8 H8 M3 11 H8" />
      <path d="M11 5 L13 11" />
    </g>
  ),
  yamato: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <path d="M2 5 Q5 11 8 7 Q11 3 14 9" strokeLinecap="round" />
    </g>
  ),
  sagawa: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
      <path d="M3 10 Q8 4 13 10" />
      <path d="M8 4 V13" />
    </g>
  ),
  hermes: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <path d="M3 13 L3 5 L8 9 L13 5 L13 13" strokeLinecap="round" />
    </g>
  ),
  dpd: (
    <g fill="currentColor" stroke="none">
      <circle cx="4" cy="8" r="1.6" />
      <circle cx="8" cy="8" r="1.6" />
      <circle cx="12" cy="8" r="1.6" />
    </g>
  ),
  amazon: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <path d="M3 10 Q8 14 13 10" />
      <path d="M11 12 L13 10 L11 8" />
    </g>
  ),
  unknown: (
    <g stroke="currentColor" strokeWidth="1.4" fill="none">
      <rect x="3" y="4" width="10" height="8" />
      <path d="M3 7 H13" />
    </g>
  ),
};

function truncate(s, max) {
  if (!s || s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
