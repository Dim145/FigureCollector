# Notifications

FigureCollector ships a fan-out notification system with **6 channels** and **per-channel routing per event**.

## Channels

| Channel | Description |
|---|---|
| **In-app** | Always-on. Bell icon in the header, badge with unread count, full log at `/notifications`. |
| **Email** | SMTP. Requires `SMTP_*` env vars. |
| **ntfy** | Pushes to a self-hosted ntfy server. User sets the topic URL. |
| **Webhook** | Generic JSON POST to a user-supplied URL. |
| **Apprise** | Apprise URL string (Discord, Telegram, Slack, …). |
| **Web Push** | Browser push (VAPID). Requires VAPID keypair generation via the admin panel. |

Each external channel can be **enabled/disabled by the admin** at the system level. Users only see channels the admin has enabled.

## Events

| Event | When | Dedup key |
|---|---|---|
| `achievement_unlocked` | A milestone achievement is granted | `(user_id, code)` |
| `preorder_release_today` | A preorder's `release_date_current` == today | `(preorder_id, release_date)` |
| `preorder_release_j7` | A preorder's `release_date_current` == today + 7 | `(preorder_id, release_date)` |
| `preorder_delivery_today` | A shipped preorder's projected delivery == today | `(preorder_id, delivery_date)` |
| `preorder_delivery_overdue` | A shipped preorder's projected delivery was yesterday and the item isn't `received` | `preorder_id` (fires only once) |
| `wishlist_price_below_target` | The [market-price sweep](cote.md#market-prices-auto-tracked) finds a price at or below a wishlist [target](wishlist.md#price-alerts) | `(figure_id, amount)` — each price level fires once; a further drop re-fires |
| `manga_server_approved` | An admin approves a submitted [MangaCollector server](manga.md) | per decision |
| `manga_server_revoked` | An admin revokes one | per decision |

The dedup table guarantees no double-fires when the worker restarts during a day.

## Routing

In **Settings → Notifications**, each user sees a routing matrix:

```
              In-app   Email   ntfy   Webhook   Apprise   Web Push
achievement     ✓        ✓      —      —          —         ✓
release today   ✓        ✓      ✓      —          —         ✓
release J-7     ✓        —      ✓      —          —         —
delivery today  ✓        ✓      —      —          —         ✓
delivery late   ✓        ✓      ✓      —          —         ✓
```

The user toggles cells; the backend records the routing in `notification_subscriptions`.

## Scheduled jobs

Two schedulers feed the event pipeline:

- the **release cron** wakes daily (after a 60 s post-boot delay so migrations
  finish first) and dispatches the four pre-order events;
- the **price sweep** (admin-scheduled, see [Administration](admin.md)) checks
  wishlist targets as part of each run.

Every run is **historized** — state, result summary, errors — on the admin
*Tâches* page, which doubles as the audit trail when someone asks why an alert
did (or didn't) fire. Admins can also re-trigger any job manually there.

## Setup

Everything is configured **in the UI** — there are no `SMTP_*` / `VAPID_*`
environment variables:

1. As admin, open [**Administration → Notifications**](admin.md): enable the
   channels you want system-wide, enter the **SMTP credentials** for email,
   and **generate the VAPID keypair** for Web Push. All of it is stored in the
   database and applies live.
2. Each user configures their personal destinations (ntfy topic, webhook URL,
   Apprise URL) under **Settings → Notifications → Channels**.
3. Each user picks their routing under **Settings → Notifications → Routing**.

## Self-test

Each external channel has a **"Envoyer un test"** button that fires a dummy notification through *that channel only*. Useful for verifying SMTP credentials or that your ntfy URL is reachable.
