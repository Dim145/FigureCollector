# URL import

When you add a figure, you can either fill the form by hand or **paste a
product URL** and let the backend resolve the metadata. FigureCollector
talks to two surfaces:

- **orzgk** is supported natively (built-in scraper, rich
  WooCommerce-variation modal lets you pick a version / payment plan
  before importing).
- **Any other store** goes through an **optional external proxy** —
  you wire up the proxy URL via env vars, FigureCollector forwards
  three requests to it, the proxy does whatever it takes to scrape the
  upstream site and returns the normalised payloads documented below.

When no proxy is configured, the SPA hides the proxy-specific search
column and the "paste a URL from store X" hint shrinks back to just
orzgk. Nothing is broken — orzgk keeps working on its own.

!!! tip "Bulk wishlist import"
    The same orzgk scraper powers
    [bulk wishlist import](wishlist.md#bulk-import-from-orzgk): paste a public
    orzgk wishlist link and add many figures to your wishlist at once.

## Why an external proxy

Scraping is fragile and site-specific. Each shop has its own DOM
layout, anti-bot defenses (Cloudflare JS challenges, AWS WAF, Akamai
TLS fingerprinting), and JavaScript-rendered content. Building and
maintaining a scraper for every shop the user might paste a link from
would drown the rest of this codebase.

A proxy lets you delegate that work — to:

- a self-hosted scraper you operate (Python+Playwright,
  scrapy+splash, Rust+rquest, …),
- a community-maintained proxy that aggregates the popular figure
  shops,
- a commercial scraping API (Scrapfly, Bright Data, ZenRows, …) you
  pay to handle the Cloudflare-class shops.

FigureCollector doesn't care which — as long as the three endpoints
respect the contract below.

## Configuring the proxy

Two env vars on the **server** container:

| Variable | Required | Purpose |
|---|---|---|
| `FIGURE_PROXY_URL`     | No (feature disabled if unset) | Proxy base URL (no trailing slash). Endpoints are appended: `<base>/stores`, `<base>/search`, `<base>/product`. |
| `FIGURE_PROXY_API_KEY` | No | When set, sent on every proxy call as `Authorization: Bearer <key>`. Use this if your proxy is exposed on a public network. |

Example:

```yaml
services:
  server:
    environment:
      FIGURE_PROXY_URL: http://figure-proxy:8080
      FIGURE_PROXY_API_KEY: ${FIGURE_PROXY_API_KEY}
```

## Proxy contract

Three HTTP `GET` endpoints. JSON in / JSON out. The proxy is free to
expose additional routes — FigureCollector only ever talks to these
three.

### `GET <base>/stores`

List of every boutique this proxy can scrape. Used by the SPA to
decide whether a pasted URL should be sent through the proxy.

**Response 200**:

```json
[
  {
    "id": "mozfigure",
    "name": "MozFigure",
    "url": "https://www.mozfigure.com",
    "hosts": ["mozfigure.com", "www.mozfigure.com"]
  },
  {
    "id": "ebay",
    "name": "eBay",
    "url": "https://www.ebay.com",
    "hosts": ["ebay.com", "www.ebay.com"]
  }
]
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable identifier, used in `?store=…` filters and `ProxyProduct.store_id`. Snake-case or kebab-case, no spaces. |
| `name` | string | yes | Human-readable label. Shown in the search column header and the "paste hint". |
| `url` | string | no | Boutique homepage. Used by the SPA to auto-link the new figure to the matching [store entity](catalogue.md). |
| `hosts` | string[] | yes | Hostnames the proxy claims to handle. Used for routing pasted URLs; matching is case-insensitive and ignores leading `www.`. |

### `GET <base>/search?q=<query>&store=<id>`

Search across the boutiques. `q` is required (≥2 chars); `store` is
optional and narrows the search to a single boutique's catalogue.

**Response 200**:

```json
[
  {
    "title": "Some Figure 1/7 scale",
    "store_id": "mozfigure",
    "store_name": "MozFigure",
    "url": "https://www.mozfigure.com/products/some-figure",
    "image_url": "https://cdn.mozfigure.com/i/abc.jpg",
    "price": { "amount": 199.50, "currency": "USD" },
    "status": "preorder"
  }
]
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Display title as shown on the listing card. |
| `store_id` | string | yes | One of the `id`s returned by `/stores`. |
| `store_name` | string | no | Convenience — saves the SPA a lookup. |
| `url` | string | yes | Full canonical URL to the product detail page. Used by the SPA to drive `/product` on click. |
| `image_url` | string | no | Best high-resolution thumbnail available. Falls back to a placeholder. |
| `price` | object | no | `{amount: number, currency: string\|null}`. Set to `null` when the listing doesn't expose a price (pre-order taking deposit only, sold out). |
| `status` | string | no | Free-form, e.g. `"in_stock"`, `"preorder"`, `"sold_out"`. The SPA renders it as a chip on the result card. |

Empty array (`[]`) is a perfectly valid response when nothing matched.

### `GET <base>/product?url=<full-or-partial>`

Fetch the metadata for a single product. The proxy is expected to
canonicalise the URL itself — accept both:

- a full URL (`https://www.mozfigure.com/products/foo`),
- a partial / hostless variant (`mozfigure.com/products/foo`,
  `/products/foo` when paired with an inferred host).

**Response 200**:

```json
{
  "store_id": "mozfigure",
  "url": "https://www.mozfigure.com/products/some-figure",
  "title": "Some Figure 1/7 scale",
  "manufacturer": "Acme Studio",
  "character": "Tatsumaki",
  "series": "One Punch Man",
  "scale": "1/7",
  "height_mm": 240,
  "materials": "PVC, ABS",
  "price": { "amount": 199.50, "currency": "USD" },
  "release_date": "2026-Q3",
  "is_nsfw": false,
  "primary_image_url": "https://cdn.mozfigure.com/i/abc-large.jpg",
  "description": "Long product description, plain text."
}
```

Every field except `store_id`, `url`, and `title` is optional. Omit
fields the upstream site doesn't expose — don't fabricate values. The
SPA only fills the form for fields that are actually present.

| Field | Type | Notes |
|---|---|---|
| `store_id` | string | One of the `id`s returned by `/stores`. |
| `url` | string | Canonical form, used as `source_url` on the figure-create payload (auto-links the figure to the matching store via hostname). |
| `title` | string | Maps to the figure form's `name`. |
| `manufacturer` | string\|null | Studio / brand. |
| `character` | string\|null | Subject. |
| `series` | string\|null | Source franchise. |
| `scale` | string\|null | `"1/4"`, `"1/7"`, `"non-scale"`, etc. |
| `height_mm` | integer\|null | Height in millimeters. |
| `materials` | string\|null | Comma-separated material list. |
| `price` | object\|null | `{amount, currency}`. |
| `release_date` | string\|null | Free-form (`"2026-Q3"`, `"2026-10"`, …). |
| `is_nsfw` | bool | Defaults to `false`. Set true for adult-rated listings; the SPA propagates this into the figure's NSFW flag. |
| `primary_image_url` | string\|null | Hero image. Stored as `official_image_url` on the figure. |
| `description` | string\|null | Plain text, no HTML. |
| `versions` | array | Optional. Purchasable versions (e.g. Regular / EX). Empty/omitted for single-version products. See below. |

### Versions

Some products ship in several versions (a "Regular" and an "EX", say) at
different prices. A proxy can expose them via `versions`; when the array has
more than one entry the SPA opens a **version picker** (the same UI as the
orzgk variation modal) instead of importing a default. The flat `price` above
should stay the default version's price for clients that ignore `versions`.

```json
{
  "...": "...other ProxyProduct fields...",
  "price": { "amount": 255.00, "currency": "USD" },
  "versions": [
    {
      "key": "regular",
      "label": "Regular",
      "image_url": "https://cdn.example.com/regular.jpg",
      "prices": [
        { "label": "deposit", "amount": 75.00, "currency": "USD", "display": "$75.00" },
        { "label": "full",    "amount": 255.00, "currency": "USD", "display": "$255.00" }
      ]
    },
    {
      "key": "ex",
      "label": "EX",
      "prices": [
        { "label": "deposit", "amount": 155.00, "currency": "USD", "display": "$155.00" },
        { "label": "full",    "amount": 435.00, "currency": "USD", "display": "$435.00" }
      ]
    }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `key` | string | yes | Stable slug, unique within the product (the picker's key). |
| `label` | string | yes | Display name (`"Regular"`, `"EX"`). |
| `image_url` | string | no | Version-specific image; falls back to `primary_image_url`. |
| `prices` | array | yes | One or more tariffs. Order them deposit-first. |

Each `prices[]` entry is `{label, amount, currency?, display}` — `label` is
free-form (`"deposit"`, `"full"`, …), `display` is the pre-rendered string the
picker shows.

## Error handling

The proxy signals failure via HTTP status. FigureCollector translates
each to a user-facing message:

| Status | FigureCollector reaction |
|---|---|
| `400` | "Proxy rejected the request (invalid URL or query)." |
| `401` / `403` | "Proxy refused authentication — check `FIGURE_PROXY_API_KEY`." |
| `404` | Standard not-found UI. |
| `501` | "Proxy doesn't support that store." Use this when `/product` receives a URL whose host isn't in `/stores`. |
| `503` | "Proxy upstream is temporarily unavailable (rate limit or remote site down)." |
| Anything else | Generic 500 with the body logged server-side. |

## Authentication

Optional. When `FIGURE_PROXY_API_KEY` is set, FigureCollector sends:

```http
Authorization: Bearer <key>
```

on every call (`/stores`, `/search`, `/product`). When unset, no
`Authorization` header is sent — appropriate for a proxy reachable
only on a trusted network (same Docker compose stack, VPN, etc.).

## Caching

FigureCollector does **not** cache proxy responses today — every
search and product fetch round-trips. The proxy is expected to do
its own caching (the upstream sites change slowly, the rate-limit
budget matters). If you need a different policy, ask — caching
support is a small wrapper away.

## Why we don't ship a proxy

Out of scope. The scrapers move fast (Cloudflare updates the JS
challenge, sites rebrand classes, JSON-LD schemas change), and the
binary that runs in `FROM scratch` shouldn't carry that maintenance
burden. Pick the proxy implementation that matches your appetite for
runtime complexity — community references will land in this page over
time.
