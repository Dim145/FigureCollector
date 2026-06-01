# Data model

A condensed reference of the main Postgres tables. The authoritative source is `server/migrations/`.

## Catalogue layer

| Table | Purpose | Key fields |
|---|---|---|
| `figures` | The shared catalogue of figurines | `name`, `figure_type`, `manufacturer_id`, `release_date`, `msrp_amount`, `is_nsfw`, `slug` |
| `manufacturers` | Companies (Good Smile, Alter, …) | `name`, `slug` |
| `series` | Anime / game / manga series | `name`, `slug` |
| `characters` | Character names | `name`, `slug` |
| `sculptors` | Sculptor credits | `name`, `slug` |
| `figure_series` | Many-to-many figure ↔ series | `figure_id`, `series_id` |
| `figure_characters` | Many-to-many figure ↔ character | `figure_id`, `character_id` |
| `figure_photos` | Shared catalogue photos | `figure_id`, `storage_key`, `is_primary`, `position` |

## User layer

| Table | Purpose | Key fields |
|---|---|---|
| `users` | User accounts | `username`, `email`, `password_hash`, `is_admin`, `nsfw_visibility`, `preferred_currency`, `public_profile_show_nsfw` |
| `owned_items` | Personal collection rows | `figure_id`, `condition`, `price_amount`, `price_currency`, `shipping_amount`, `purchase_date`, `cover_photo_id`, `cover_scan_id`, `archived_at` |
| `photos` | Personal photos | `owned_item_id`, `storage_key`, `position` |
| `scans` | 360° turntable frames | `owned_item_id`, `storage_keys` (array) |
| `wishlist_items` | "Want to own" list | `figure_id`, `max_price_amount` |

## Pre-order lifecycle

| Table | Purpose | Key fields |
|---|---|---|
| `preorders` | Pre-order rows tied to an owned_item | `owned_item_id` (unique), `status`, `release_date_original`, `release_date_current`, `tracking_url`, `price_amount`, **`deposit_amount`**, **`deposit_refund_amount`**, **`shipped_at`**, **`estimated_delivery_days`** |
| `preorder_date_history` | Slip log | `preorder_id`, `previous_date`, `new_date`, `source`, `note` |

The **bolded** columns are the recent additions (deposit, cancellation refund, delivery ETA).

## Notifications

| Table | Purpose | Key fields |
|---|---|---|
| `notifications` | Per-user notification log | `user_id`, `event_type`, `payload` (JSONB), `read_at` |
| `notification_subscriptions` | Per-channel routing | `user_id`, `channel_type`, `event_type`, `enabled` |
| `notification_channels` | System-level channel configuration | `channel_type`, `enabled` (admin toggle) |
| `notification_dedup` | Prevents double-fires | `user_id`, `dedup_key`, `created_at` |
| `web_push_subscriptions` | VAPID subscriptions | `user_id`, `endpoint`, `keys` |

## MangaCollector synergy

| Table | Purpose | Key fields |
|---|---|---|
| `manga_servers` | Admin-curated allow-list of MangaCollector origins | `base_url` (unique, normalized origin), `status` (`pending` / `approved` / `revoked`), `submitted_by`, `reviewed_by`, `reviewed_at`, `note` |

The link itself lives on `users` — `manga_server_id` (→ `manga_servers`) + `manga_slug`. The join to the catalogue is `series.mal_id` (populated from the AniList `idMal`), so a figure's series and a MangaCollector library entry line up with no manual mapping. Cross-link fetches only fire when the linked server is `approved`.

## Activity + achievements

| Table | Purpose | Key fields |
|---|---|---|
| `activity_events` | Audit log for the user feed and stats | `user_id`, `kind`, `payload`, `created_at` |
| `achievements` | Unlocked achievements per user | `user_id`, `code`, `tier`, `unlocked_at` |

## Auth

| Table | Purpose |
|---|---|
| `oidc_identities` | Federated identity links (Google, generic) |
| `tower_sessions` | Server-side session storage |

## Migrations

All migrations live in `server/migrations/` as plain `.sql` files, wrapped by `server/src/migration/m20260524_*.rs` modules. The SeaORM `MigratorTrait` runs them in lexical order on backend boot.

Idempotent by design (`IF NOT EXISTS`, `OR REPLACE`), so a restart is always safe.
