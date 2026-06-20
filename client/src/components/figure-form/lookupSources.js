// Source adapters + field-mapping for the figure lookup flow.
//
// The two external detail wizards (orzgk's `OrzgkDetailModal` and the proxy's
// `ProxyDetailModal`) used to re-implement the SAME Versions → Prices → Apply
// flow twice, each with its own spec grid + image picker + buildPick call. This
// module collapses that to ONE shape so a single `<LookupDetailModal>` can
// drive both: each source is described by an adapter that knows how to read a
// detail/product payload (title, hero image, spec rows, versions, prices) and
// how to turn the user's (version, price) choice into the form-prefill payload.
//
// All the real mapping still lives in lib/orzgkMap.js + lib/proxyMap.js — this
// only routes to them. Single source of truth, no drift with the bulk importer.

import { api, ApiError } from "../../lib/api.js";
import { fetchProxyProduct } from "../../hooks/useProxy.js";
import { ORZGK_URL_RE, buildPick, pickImage } from "../../lib/orzgkMap.js";
import {
  buildProxyPick,
  defaultProxyPick,
  hostnameOf,
  pickProxyImage,
  proxyHandles,
} from "../../lib/proxyMap.js";

export const ORZGK_HOME = "https://orzgk.com";
export const MFC_HOME = "https://myfigurecollection.net";

/** Build the spec-row list `[ [i18nKey, value], … ]` an orzgk detail exposes,
 *  preferring the cleaner description-mined alternates. Mirrors the old
 *  `SpecGrid`. */
function orzgkSpecRows(detail) {
  const series = detail.product_ip ?? detail.origin;
  const character = detail.product_role ?? detail.character;
  return [
    ["brand", detail.brand],
    ["origin", series],
    ["character", character],
    ["kind", detail.kind],
    ["scale", detail.scale],
    ["size", detail.size],
    ["height_mm", detail.height_mm ? `${detail.height_mm} mm` : null],
    ["height_range", detail.height_range],
    ["material", detail.product_material],
    ["feature", detail.feature],
    ["limited_units", detail.limited_units],
    ["preorder_start_date", detail.preorder_start_date],
    ["est_completion", detail.est_completion ?? detail.est_released_time],
    ["special_description", detail.special_description],
  ].filter(([, v]) => !!v);
}

/** Spec rows a proxy product exposes. Mirrors the old `ProxySpecGrid`. */
function proxySpecRows(product) {
  return [
    ["brand", product.manufacturer],
    ["origin", product.series],
    ["character", product.character],
    ["scale", product.scale],
    ["height_mm", product.height_mm ? `${product.height_mm} mm` : null],
    ["material", product.materials],
    ["est_completion", product.release_date],
  ].filter(([, v]) => !!v);
}

/**
 * The source adapters. Each normalises one provider's payload to the shape the
 * unified `<LookupDetailModal>` consumes:
 *
 *   eyebrowKey   i18n key for the modal eyebrow ("Import orzgk" / boutique)
 *   title(d)     human title for the header
 *   versions(d)  the selectable versions (or []) — each { key, label, image_url, prices }
 *   prices(d)    top-level prices when there are no versions (orzgk only)
 *   image(d, v)  hero/preview image for the current (detail, selectedVersion)
 *   specRows(d)  [ [i18nKey, value], … ] for the spec grid
 *   buildPick(d, v, p)  → the form-prefill payload
 */
export const SOURCE_ADAPTERS = {
  orzgk: {
    eyebrowKey: "lookup.figure.detail.eyebrow",
    title: (d) => d?.title,
    versions: (d) => d?.versions ?? [],
    prices: (d) => d?.prices ?? [],
    image: (d, v) => pickImage(d, v),
    specRows: orzgkSpecRows,
    buildPick,
  },
  proxy: {
    // Proxy results carry their own boutique name; the generic "import" eyebrow
    // reads fine and we already show the store on the result row.
    eyebrowKey: "lookup.figure.detail.eyebrow",
    title: (p) => p?.title,
    versions: (p) => p?.versions ?? [],
    // Proxy products expose prices only via their versions.
    prices: () => [],
    image: (p, v) => pickProxyImage(p, v),
    specRows: proxySpecRows,
    buildPick: buildProxyPick,
  },
};

export function adapterFor(source) {
  return SOURCE_ADAPTERS[source] ?? SOURCE_ADAPTERS.orzgk;
}

// ── URL dispatch ────────────────────────────────────────────────────────────

/** Classify a pasted/typed string so the search panel can decide what to do:
 *   { kind: "orzgk-url" }            → open the detail wizard via orzgk
 *   { kind: "proxy-url" }            → resolve via the proxy product endpoint
 *   { kind: "query" }                → free-text search
 *  `proxy` is the `useProxyEnabled()` result. */
export function classifyInput(raw, proxy) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { kind: "query", value: "" };
  if (ORZGK_URL_RE.test(trimmed)) return { kind: "orzgk-url", value: trimmed };
  if (proxy?.enabled && /^https?:\/\//i.test(trimmed)) {
    const host = hostnameOf(trimmed);
    if (host && proxyHandles(proxy.stores, host)) {
      return { kind: "proxy-url", value: trimmed };
    }
  }
  return { kind: "query", value: trimmed };
}

export function isUrl(raw) {
  return /^https?:\/\//i.test((raw ?? "").trim());
}

// ── Detail fetchers ───────────────────────────────────────────────────────

/** Fetch an orzgk product detail by URL. */
export function fetchOrzgkDetail(url) {
  return api.get(`/external/orzgk/detail?url=${encodeURIComponent(url)}`);
}

export { fetchProxyProduct, defaultProxyPick };

// ── Name search ─────────────────────────────────────────────────────────────

/** The boutiques a name-search hits AND whose product links can be pasted to
 *  import directly: orzgk natively (always on) + every store the configured
 *  proxy supports. MFC is intentionally absent — its scrape is Cloudflare-
 *  blocked, so it's import-by-paste only (its own tab). */
export function searchSources(proxyStores) {
  const orzgk = { id: "orzgk", name: "orzgk", href: ORZGK_HOME };
  const proxied = (proxyStores ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    href: s.url || (s.hosts?.[0] ? `https://${s.hosts[0]}` : null),
  }));
  return [orzgk, ...proxied];
}

/** Run the name search across orzgk (always) + the proxy boutiques (when
 *  configured). Each provider resolves to `{ rows, error }` so a failure is
 *  attributed to its source rather than collapsing the whole list. Returns
 *  `{ rows, errors }`. */
export async function runSearch(q, { proxyEnabled }) {
  const calls = [
    api.get(`/external/orzgk/search?q=${encodeURIComponent(q)}`).then(
      (rows) => ({
        rows: rows.map((r) => ({ ...r, source: "orzgk" })),
        error: null,
      }),
      (e) => ({ rows: [], error: { source: "orzgk", message: e?.message ?? "échec" } }),
    ),
  ];

  if (proxyEnabled) {
    calls.push(
      api.get(`/external/proxy/search?q=${encodeURIComponent(q)}`).then(
        (rows) => ({
          rows: rows.map((r) => ({
            source: "proxy",
            title: r.title,
            detail_url: r.url,
            image_url: r.image_url ?? null,
            studio: r.store_name ?? r.store_id,
            status: r.status ?? null,
            price_range:
              r.price?.amount != null ? `${r.price.amount} ${r.price.currency ?? ""}`.trim() : null,
            proxy_store_id: r.store_id,
          })),
          error: null,
        }),
        (e) => ({
          rows: [],
          // "proxy not configured" is the normal off state, not a failure.
          error:
            e instanceof ApiError && e.code === "feature_disabled"
              ? null
              : { source: "proxy", message: e?.message ?? "échec" },
        }),
      ),
    );
  }

  const parts = await Promise.all(calls);
  return {
    rows: parts.flatMap((p) => p.rows),
    errors: parts.map((p) => p.error).filter(Boolean),
  };
}

// ── MFC paste import ─────────────────────────────────────────────────────────

const TYPE_MAP = {
  "gk statue": "statue",
  "pvc figure": "scale",
  "scale figure": "scale",
  nendoroid: "nendoroid",
  figma: "figma",
  "prize figure": "prize",
  prize: "prize",
  "trading figure": "trading",
  "plastic model": "plamo",
  bishoujo: "bishoujo",
  dakimakura: "dakimakura",
};

function mapType(kind) {
  if (!kind) return undefined;
  const key = kind.trim().toLowerCase();
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (key.includes(k)) return v;
  }
  return undefined;
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

const MFC_MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Best-effort normalise MFC's raw release-date text to ISO `YYYY-MM-DD`:
 *  "December 2024" / "2024-08" / "2024/08/15" / "2024". Unparseable → undefined. */
export function mfcDate(raw) {
  if (!raw) return undefined;
  const s = String(raw).trim();
  const month = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (month) {
    const mo = MFC_MONTHS[month[1].toLowerCase()];
    if (mo) return `${month[2]}-${pad2(mo)}-01`;
  }
  const iso = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3] ?? "01")}`;
  const year = s.match(/^(\d{4})$/);
  if (year) return `${year[1]}-01-01`;
  return undefined;
}

/** Map a parsed MfcItem to the figure-form prefill payload. */
export function mapMfcItem(item) {
  return {
    name: item.name || undefined,
    manufacturer_name: item.manufacturer || undefined,
    sculptor_name: item.sculptor || undefined,
    series_name: item.origin || undefined,
    character_name: item.character || undefined,
    figure_type: mapType(item.category),
    scale: item.scale || undefined,
    height_mm: item.height_mm != null ? String(item.height_mm) : undefined,
    materials: item.materials?.length ? item.materials.join(", ") : undefined,
    official_image_url: item.official_image_url || undefined,
    jan: item.jan || undefined,
    msrp_amount: item.release_price_jpy != null ? String(item.release_price_jpy) : undefined,
    msrp_currency: item.release_price_jpy != null ? "JPY" : undefined,
    release_date: mfcDate(item.release_date),
  };
}

/** Minimal payload for a detail-less search row (MFC-shaped legacy rows) so a
 *  pick still puts *something* into the form. */
export function legacyPick(row, t) {
  return {
    name: row.title ?? row.name ?? "",
    manufacturer_name: row.studio ?? row.manufacturer ?? undefined,
    scale: row.scale ?? undefined,
    official_image_url: row.image_url ?? row.official_image_url ?? undefined,
    character_name: row.character ?? undefined,
    series_name: row.origin ?? undefined,
    jan: row.jan ?? undefined,
    description: row.detail_url
      ? `${t("lookup.figure.source_prefix")} ${row.detail_url}`
      : undefined,
    source_url: row.detail_url,
  };
}

/** Map an orzgk payment slug to a translated label. Unknown slugs are
 *  humanised as a courtesy. */
export function paymentLabel(slug, t) {
  const known = ["deposit", "full"];
  if (known.includes(slug)) return t(`lookup.figure.detail.payment.${slug}`);
  return slug
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
