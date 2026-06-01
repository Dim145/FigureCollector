# MangaCollector synergy

FigureCollector pairs with [MangaCollector](https://github.com/Dim145/MangaCollector) (same author, same architecture). Link your MangaCollector profile and the two shelves line up — **the manga you read** and **the figures you collect** — joined on the series' shared **MyAnimeList id**.

The link is **read-only** and goes through your **public** MangaCollector profile: no password, no API token, nothing FigureCollector couldn't already see by visiting your public profile URL.

## How the join works

Both apps store a series' **MAL id** (`series.mal_id` on FigureCollector — populated from the AniList `idMal` — and the `mal_id` of each MangaCollector library entry). A figure links to a series via `figure_series`, so a figure and a manga line up with **no manual mapping**:

```
figure ──figure_series──▶ series ──mal_id──▶ manga (MangaCollector)
```

## Linking your collection

**Settings → 漫 MangaCollector.** You don't type an arbitrary host — you **pick a server the admin has approved**, or **propose a new one**.

| You do | What happens |
|---|---|
| Pick an **approved** server + enter your public slug | The link goes live immediately; FigureCollector test-fetches your profile to confirm the slug. |
| **Propose a new** server (URL + slug) | The server is submitted to the registry as **pending**; your link is saved but **dormant** until an admin approves it. |

The drawer then shows one of three faces:

- **Active** — the library tally (series · volumes read) + a link to your public profile.
- **Pending** — "awaiting an administrator"; the integration is paused, nothing else to do.
- **Revoked** — an admin pulled the server (with a reason); pick another.

## Server registry (admin allow-list)

!!! abstract "Why an allow-list?"
    The MangaCollector host a user enters drives a **server-side outbound fetch**. Rather than let anyone point FigureCollector at an arbitrary host, the set of reachable instances is an **admin-curated allow-list**. Submitting a server only ever creates an inert `pending` row — and the URL is [SSRF-validated](../architecture/security.md) *before* it is even stored.

Admins manage the list under **Admin → Serveurs manga** (`/admin/manga-servers`):

| Status | Meaning | Integration |
|---|---|---|
| `pending` | User-submitted, awaiting review | **off** — no fetch, no crossings, no badge |
| `approved` | Vetted by an admin | **on** |
| `revoked` | Pulled by an admin (optional reason) | **off** |

Admin actions: **approve** (pending → approved, or re-approve a revoked one), **revoke** (with an optional reason), **rename** (set a friendly label), **delete** (only when no user is linked — revoke an in-use server first).

!!! warning "Revocation cascades"
    Revoking a server **notifies every user linked to it** (in-app bell + real-time) — the reason rides along — and their integration **stops immediately**. Every query is gated on `status = 'approved'`, so a revoked (or pending) server resolves to no crossings, no badge, and no outbound fetch. Approving a pending server likewise notifies its waiting users that it is now live.

## What you see

### Croisements (`/croisements`)

Two columns, both keyed on the shared MAL id:

- **Figures from series you read** — you own the manga, not (yet) the figure. A nudge toward the wishlist.
- **Series in both** — manga *and* figure: the heart of a collection, with reading progress + figure count.

A pending or revoked link shows a status banner here instead of a (necessarily empty) result.

### On a figure

A figure whose series is in your manga library shows a **"📚 in your manga collection"** badge: reading progress (`vol. 7/12 · 58 % read`) and a link to open the series on your MangaCollector instance.

## The public mirror

The reverse direction is a single **anonymous** endpoint, so a MangaCollector instance (or anything else) can show "figures available for this manga":

```http
GET /api/public/figures/by-mal/31706
→ { "mal_id": 31706, "count": 3, "figures": [ { "name": "Rem 1/7", "slug": … } … ] }
```

SFW by default; an opted-in caller passes `?nsfw=1`. This is the half FigureCollector **exposes** — the MangaCollector-side snippet that consumes it lives in that project, not here.

## Security & privacy

- **Read-only**, via your **public** profile — no credentials stored.
- **SSRF egress guard** on every fetch: the *resolved* IP is rejected when private / loopback / link-local / CGNAT / ULA / metadata, and the HTTP client follows only same-host redirects. Reuses the exact guard the notification webhooks use — see the [security contract](../architecture/security.md).
- **Admin allow-list** — only vetted origins are ever fetched; submissions are SSRF-checked before they are stored as `pending`.
- **Cached 24 h** server-side per `(server, slug)`, so a popular instance is hit at most once a day per linked account.
- **NSFW follows your settings** — the cross-link view respects your `nsfw_visibility` (hide / blur / show); the public mirror follows `public_profile_show_nsfw` plus the caller's `?nsfw=1` opt-in. See [NSFW handling](nsfw.md).

## Setup

1. **Admin** — when a user proposes a server, review it under **Admin → Serveurs manga** and **approve** the ones you trust.
2. **User** — in **Settings → MangaCollector**, pick an approved server (or propose your instance) and enter your **public profile slug**.
3. Open **Croisements** to see where your two shelves meet.
