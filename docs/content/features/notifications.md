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

A single tokio task wakes every 24 h (after a 60 s post-boot delay so migrations finish first). For each tick it runs the SQL queries that find due preorders for `release_today`, `release_j7`, `delivery_today`, and `delivery_overdue`, and dispatches each through `services::notify::dispatch`.

## Setup

1. As admin, generate a VAPID keypair under **Settings → Admin → Notifications**.
2. Add SMTP credentials in `.env.prod` if you want email.
3. Each user configures their personal destinations (ntfy topic, webhook URL, Apprise URL) under **Settings → Notifications → Channels**.
4. Each user picks their routing under **Settings → Notifications → Routing**.

## Self-test

Each external channel has a **"Envoyer un test"** button that fires a dummy notification through *that channel only*. Useful for verifying SMTP credentials or that your ntfy URL is reachable.
