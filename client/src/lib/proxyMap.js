// External boutique proxy → figure-form mapping. The proxy counterpart of
// lib/orzgkMap.js: turns a ProxyProduct (optionally with a chosen version /
// price) into the `NewFigure`-shaped payload the add-figure form consumes.
//
// Kept separate from orzgkMap because the proxy product already gives us clean,
// normalised fields (ISO release_date, computed is_nsfw, …) — we must NOT
// re-derive them the way the orzgk mapping does, or we'd lose them.

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD"];

function mapCurrency(c) {
  if (!c) return undefined;
  const upper = c.toUpperCase();
  return SUPPORTED_CURRENCIES.includes(upper) ? upper : undefined;
}

/** Image to show / import: the chosen version's image, else the product hero. */
export function pickProxyImage(product, version) {
  return version?.image_url ?? product?.primary_image_url ?? null;
}

/** Map a ProxyProduct + chosen version/price into the figure-form payload. */
export function buildProxyPick(product, version, price) {
  // msrp: the explicitly-picked tariff wins, else the version's "full" tariff,
  // else the product's flat price.
  const amount =
    price?.amount ??
    version?.prices?.find((p) => /full/i.test(p.label))?.amount ??
    product.price?.amount;
  const currency =
    price?.currency ?? version?.prices?.[0]?.currency ?? product.price?.currency;

  return {
    name: product.title,
    manufacturer_name: product.manufacturer ?? undefined,
    series_name: product.series ?? undefined,
    character_name: product.character ?? undefined,
    scale: product.scale ?? undefined,
    height_mm: product.height_mm != null ? String(product.height_mm) : undefined,
    materials: product.materials ?? undefined,
    official_image_url: pickProxyImage(product, version) ?? undefined,
    msrp_amount: amount != null ? String(Number(amount).toFixed(2)) : undefined,
    msrp_currency: mapCurrency(currency),
    release_date: product.release_date ?? undefined,
    description: product.description ?? undefined,
    is_nsfw: product.is_nsfw || undefined,
    version_name: version?.label,
    // The pasted URL — the backend uses its hostname to auto-link the new
    // figure to the matching store at create time.
    source_url: product.url,
  };
}

/** Default selection for a product imported without opening the picker: the
 *  first version (if any) and its "full" tariff (else the first tariff). */
export function defaultProxyPick(product) {
  const version = product.versions?.[0] ?? null;
  const prices = version?.prices ?? [];
  const price = prices.find((p) => /full/i.test(p.label)) ?? prices[0] ?? null;
  return buildProxyPick(product, version, price);
}
