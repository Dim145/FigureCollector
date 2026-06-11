// orzgk → figure-form mapping. Extracted from FigureLookup so the bulk
// wishlist importer creates catalogue figures through the EXACT same mapping
// the add-figure page uses (single source of truth — no drift).

/** A pasted/typed string is a direct orzgk product link. */
export const ORZGK_URL_RE = /^https?:\/\/(www\.)?orzgk\.com\/product\//i;

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

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD"];

/** Normalise a scraped currency to a supported ISO code (else undefined).
 *  Exported for the proxy mapping (lib/proxyMap.js). */
export function mapCurrency(c) {
  if (!c) return undefined;
  const upper = c.toUpperCase();
  return SUPPORTED_CURRENCIES.includes(upper) ? upper : undefined;
}

/** Convert various orzgk date formats into ISO `YYYY-MM-DD`:
 *   - `"2027/12"`        → `"2027-12-01"`
 *   - `"2027/12/15"`     → `"2027-12-15"`
 *   - `"2027 Q4"`        → `"2027-10-01"` (Q1/Q2/Q3/Q4 → 01/04/07/10)
 *   - `"2027"`           → `"2027-01-01"`
 *   - anything else      → `undefined`
 *
 * Tries each candidate string in order and returns the first match — call
 * with the most precise source first (`est_completion`, then `est_released_time`).
 * Exported for the proxy mapping (lib/proxyMap.js) — proxies emit the same
 * free-form dates ("2026-Q3", "2026/10").
 */
export function parseReleaseDate(...candidates) {
  for (const raw of candidates) {
    if (!raw) continue;
    const s = String(raw).trim();
    // YYYY/MM[/DD]
    const slash = s.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
    if (slash) {
      return `${slash[1]}-${pad2(slash[2])}-${pad2(slash[3] ?? "01")}`;
    }
    // YYYY QN  /  YYYY-QN
    const quarter = s.match(/^(\d{4})[\s-]*Q([1-4])$/i);
    if (quarter) {
      const month = { 1: "01", 2: "04", 3: "07", 4: "10" }[quarter[2]];
      return `${quarter[1]}-${month}-01`;
    }
    // Plain year
    const year = s.match(/^(\d{4})$/);
    if (year) return `${year[1]}-01-01`;
  }
  return undefined;
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

export function pickImage(detail, version) {
  return version?.image_url ?? detail?.primary_image_url ?? detail?.images?.[0] ?? null;
}

/** orzgk gives materials as one free string ("Imported PU, high-grade resin");
 *  `NewFigure.materials` is a string array. Split on the usual separators.
 *  Exported for the proxy mapping (lib/proxyMap.js). */
export function splitMaterials(raw) {
  if (!raw || typeof raw !== "string") return undefined;
  const parts = raw.split(/[,/·;]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

/** Map an orzgk product detail + a chosen version/price into the figure-form
 *  payload (`NewFigure`-shaped) consumed by POST /figures. */
export function buildPick(detail, version, price) {
  // NSFW heuristic: orzgk uses "18+" on adult listings; some pages also use
  // "Adult", "R-18". Either source (spec row or description-mined) works.
  const feature = (detail.feature ?? "").toLowerCase();
  const isNsfw =
    feature.includes("18+") ||
    feature.includes("adult") ||
    feature.includes("r-18") ||
    feature.includes("r18");

  // The description block has cleaner alternates to several spec rows —
  // prefer them when available. `From:` famously returns "Anime Figure - One
  // Punch Man", `Product IP:` returns just "One Punch Man".
  const series = detail.product_ip ?? detail.origin;
  const character = detail.product_role ?? detail.character;

  const descLines = [];
  if (detail.url) descLines.push(`Source: ${detail.url}`);
  if (detail.kind) descLines.push(`Type: ${detail.kind}`);
  if (detail.size) descLines.push(`Size: ${detail.size}`);
  if (detail.height_range) descLines.push(`Height range: ${detail.height_range}`);
  if (detail.feature) descLines.push(`Feature: ${detail.feature}`);
  if (detail.limited_units) descLines.push(`Limited edition: ${detail.limited_units}`);
  if (detail.preorder_start_date)
    descLines.push(`Pre-order: ${detail.preorder_start_date}`);
  if (detail.est_completion)
    descLines.push(`Est. completion: ${detail.est_completion}`);
  else if (detail.est_released_time)
    descLines.push(`Est. release: ${detail.est_released_time}`);
  if (detail.product_material)
    descLines.push(`Material: ${detail.product_material}`);
  if (detail.special_description)
    descLines.push(`Special: ${detail.special_description}`);
  if (version) descLines.push(`Version: ${version.label}`);
  if (price) descLines.push(`Tariff: ${price.display} (${price.label})`);

  return {
    name: detail.title,
    manufacturer_name: detail.brand,
    series_name: series,
    character_name: character,
    figure_type: mapType(detail.kind),
    scale: detail.scale,
    // Emit real NewFigure types (number / array), not form-state strings: the
    // bulk importer POSTs this payload straight to /figures (no form to
    // normalise it), and the add-page's makeInitialForm handles these fine too.
    height_mm: detail.height_mm ?? undefined,
    materials: splitMaterials(detail.product_material),
    // The orzgk URL the user pasted — the backend uses its hostname to
    // auto-link the new figure to the matching store at create time.
    source_url: detail.url,
    // Limited editions: surface the count via the `edition` field; the
    // exclusivity slot is reserved for retailer / channel exclusives.
    edition: detail.limited_units ? `Limited ${detail.limited_units}` : undefined,
    official_image_url: pickImage(detail, version),
    version_name: version?.label,
    // Amount and currency travel together: an amount whose currency the app
    // doesn't support would be ambiguous data, so neither is set. (The server
    // already normalises scraped prices into supported currencies — exotic →
    // USD-converted, missing → assumed USD — so this is a safety net.)
    msrp_amount:
      price?.amount && mapCurrency(price?.currency)
        ? String(price.amount.toFixed(2))
        : undefined,
    msrp_currency: price?.amount ? mapCurrency(price?.currency) : undefined,
    release_date: parseReleaseDate(detail.est_completion, detail.est_released_time),
    is_nsfw: isNsfw || undefined,
    description: descLines.length ? descLines.join("\n") : undefined,
  };
}

/** Bulk-import convenience: pick a version (matching `preferredVersionLabel`
 *  when given — e.g. the variant the user wishlisted — else the first) and a
 *  price (prefer the "full" payment), then map via {@link buildPick}. */
export function autoPickFromDetail(detail, preferredVersionLabel) {
  const versions = detail?.versions ?? [];
  let version = null;
  if (versions.length) {
    if (preferredVersionLabel) {
      const want = preferredVersionLabel.trim().toLowerCase();
      version =
        versions.find((v) => (v.label ?? "").trim().toLowerCase() === want) ?? null;
    }
    version = version ?? versions[0];
  }
  const prices = version?.prices ?? detail?.prices ?? [];
  const price = prices.find((p) => /full/i.test(p.label)) ?? prices[0] ?? null;
  return buildPick(detail, version, price);
}
