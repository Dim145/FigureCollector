/**
 * Parse a tracking URL into { carrier, number, canonicalUrl, … }.
 *
 * The user pastes whatever tracking link the carrier emailed them — those
 * URLs sometimes carry extra noise (campaign params, login redirects, …),
 * sometimes are missing the protocol, occasionally are just the carrier's
 * domain with no number at all. This module normalises all of that into a
 * predictable shape the UI can render: a friendly carrier name, the
 * tracking number when we can find it, and a clean canonical tracking URL.
 *
 * No network call is made — pure URL parsing. Carrier-side live status
 * (in transit / delivered / …) would require per-carrier API credentials,
 * which is out of scope for a self-hosted PWA.
 *
 * Adding a carrier = one entry in `CARRIERS`. Each entry lists:
 *   - `name`     : how it should be displayed in the UI
 *   - `hosts`    : domains this carrier owns. We match on suffix
 *                  ("foo.example.com" matches "example.com").
 *   - `params`   : URL query-parameter names that carry the tracking number,
 *                  tried in order until one yields a non-empty value.
 *   - `track`    : function building the canonical tracking page URL.
 *   - `validate` : optional regex restricting accepted numbers (rare).
 */

const CARRIERS = [
  {
    id: "ups",
    name: "UPS",
    hosts: ["ups.com", "wwwapps.ups.com"],
    params: ["tracknum", "InquiryNumber1", "trackingNumber", "trackingnumber"],
    track: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  },
  {
    id: "dhl",
    name: "DHL",
    hosts: ["dhl.com", "dhl.de", "mydhl.express.dhl"],
    params: ["tracking-id", "trackingNumber", "AWB", "tracking_id"],
    track: (n) =>
      `https://www.dhl.com/global-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=${encodeURIComponent(n)}`,
  },
  {
    id: "colissimo",
    name: "Colissimo",
    hosts: ["laposte.fr", "colissimo.fr"],
    params: ["code"],
    track: (n) =>
      `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(n)}`,
  },
  {
    id: "chronopost",
    name: "Chronopost",
    hosts: ["chronopost.fr"],
    params: ["listeNumerosLT", "code"],
    track: (n) =>
      `https://www.chronopost.fr/tracking-no-cms?listeNumerosLT=${encodeURIComponent(n)}`,
  },
  {
    id: "fedex",
    name: "FedEx",
    hosts: ["fedex.com"],
    params: ["tracknumbers", "trackingnumber", "trackingNumber"],
    track: (n) =>
      `https://www.fedex.com/fedextrack/?tracknumbers=${encodeURIComponent(n)}`,
  },
  {
    id: "usps",
    name: "USPS",
    hosts: ["usps.com", "tools.usps.com"],
    params: ["tLabels", "qtc_tLabels1", "labels"],
    track: (n) =>
      `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
  },
  {
    id: "mondialrelay",
    name: "Mondial Relay",
    hosts: ["mondialrelay.fr", "mondialrelay.com"],
    params: ["numeroExpedition", "NumeroExpedition"],
    track: (n) =>
      `https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=${encodeURIComponent(n)}`,
  },
  {
    id: "gls",
    name: "GLS",
    hosts: ["gls-group.com", "gls-group.eu", "gls-group.net"],
    params: ["match", "trackId"],
    track: (n) => `https://gls-group.com/track?match=${encodeURIComponent(n)}`,
  },
  {
    id: "tnt",
    name: "TNT",
    hosts: ["tnt.com"],
    params: ["cons", "consignmentNumber"],
    track: (n) =>
      `https://www.tnt.com/express/en_us/site/shipping-tools/tracking.html?searchType=con&cons=${encodeURIComponent(n)}`,
  },
  {
    id: "japanpost",
    name: "Japan Post",
    hosts: ["post.japanpost.jp", "trackings.post.japanpost.jp"],
    params: ["reqCodeNo1", "requestNo1"],
    track: (n) =>
      `https://trackings.post.japanpost.jp/services/srv/search/?reqCodeNo1=${encodeURIComponent(n)}&locale=en`,
  },
  {
    id: "ems",
    name: "EMS",
    hosts: ["ems.com.cn", "ems.post"],
    params: ["mailNum", "mailNo"],
    track: (n) =>
      `https://www.ems.com.cn/queryList?mailNum=${encodeURIComponent(n)}`,
  },
  {
    id: "yamato",
    name: "Yamato Transport",
    hosts: ["kuronekoyamato.co.jp", "track.kuronekoyamato.co.jp"],
    params: ["number01", "tracking_no"],
    track: (n) =>
      `https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number01=${encodeURIComponent(n)}`,
  },
  {
    id: "sagawa",
    name: "Sagawa Express",
    hosts: ["sagawa-exp.co.jp", "k2k.sagawa-exp.co.jp"],
    params: ["okurijoNo"],
    track: (n) =>
      `https://k2k.sagawa-exp.co.jp/p/sagawa/web/okurijoNoSearch.do?okurijoNo=${encodeURIComponent(n)}`,
  },
  {
    id: "hermes",
    name: "Hermes",
    hosts: ["myhermes.co.uk", "evri.com"],
    params: ["trackingNumber"],
    track: (n) =>
      `https://www.evri.com/track-a-parcel?trackingNumber=${encodeURIComponent(n)}`,
  },
  {
    id: "dpd",
    name: "DPD",
    hosts: ["dpd.com", "dpd.co.uk", "dpd.fr", "dpd.de"],
    params: ["parcelNumber", "trackid"],
    track: (n) =>
      `https://www.dpd.com/tracking/${encodeURIComponent(n)}`,
  },
  {
    id: "amazon",
    name: "Amazon Logistics",
    hosts: ["amazon.com", "amazon.fr", "amazon.co.uk", "amazon.de", "amazon.co.jp"],
    params: ["trackingId", "orderID"],
    track: (n) =>
      `https://track.amazon.com/tracking/${encodeURIComponent(n)}`,
  },
];

/**
 * Parse `input` (a string the user typed in the form) into a structured
 * tracking descriptor. Returns `null` for empty input. Returns a generic
 * `{ id: "unknown", … }` for hosts we don't recognise (we still surface
 * the link so the user can click through).
 *
 * @param {string|null|undefined} input
 * @returns {null | {
 *   id: string,
 *   name: string,
 *   number: string|null,
 *   canonicalUrl: string,
 *   originalUrl: string,
 *   knownCarrier: boolean,
 * }}
 */
export function parseTrackingUrl(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Accept bare hosts ("ups.com/...") by prepending https://
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  // Match against the known list by host suffix.
  const carrier = CARRIERS.find((c) =>
    c.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );

  if (carrier) {
    // Pick up the first non-empty param that matches.
    let number = null;
    for (const p of carrier.params) {
      const v = url.searchParams.get(p);
      if (v && v.trim()) {
        number = v.trim();
        break;
      }
    }
    // Fallback: some carriers stash the number in the path (DPD uses
    // /tracking/{number}, Amazon uses /tracking/{id}). If params didn't
    // surface one, try the last non-empty path segment.
    if (!number) {
      const segments = url.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      // Heuristic: only accept if it looks like a tracking number
      // (≥ 8 chars, alphanumeric / hyphens).
      if (last && /^[A-Za-z0-9-]{8,}$/.test(last)) {
        number = last;
      }
    }
    return {
      id: carrier.id,
      name: carrier.name,
      number,
      canonicalUrl: number ? carrier.track(number) : raw,
      originalUrl: raw,
      knownCarrier: true,
    };
  }

  // Unknown carrier — at least show the host.
  return {
    id: "unknown",
    name: host,
    number: null,
    canonicalUrl: raw,
    originalUrl: raw,
    knownCarrier: false,
  };
}

/** Convenience: returns just the recognised carrier id, or null. */
export function detectCarrier(url) {
  return parseTrackingUrl(url)?.id ?? null;
}
