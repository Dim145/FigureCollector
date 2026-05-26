# NSFW handling

FigureCollector treats NSFW (Not-Safe-For-Work) figurines as a first-class concept. Each user picks how they want NSFW content to behave.

## The setting

Under **Settings → Sensibilité (NSFW)**, three options:

| Pref | Behavior on `/browse` + `/collection` | Behavior on figure detail | Upload behavior |
|---|---|---|---|
| **`hide`** | NSFW figures are filtered out entirely | Detail page replaces the hero with a 禁 interstitial requiring an explicit "I want to see it" click | Disabled on NSFW figures |
| **`blur`** | Cards visible, but the figure image is blurred (CSS filter) | Hero shows blurred until user acknowledges | Disabled on NSFW figures |
| **`show`** | Cards visible, full resolution | Full resolution | Enabled |

The setting lives on `users.nsfw_visibility`. Changes propagate immediately via TanStack invalidation — no page reload needed.

## The flag

`figures.is_nsfw` is a boolean column. Set it:

- Manually when adding a figure (checkbox on the form).
- Inherited from MFC's NSFW tag when scraping.

Once set, every photo of that figure inherits the same handling — there's no per-photo NSFW flag.

## Public profile interaction

A user's public profile (`/u/<slug>`) defaults to **hiding NSFW pieces** even when the profile owner has `nsfw_visibility = show`. There's a separate toggle `users.public_profile_show_nsfw` (default `false`) that the owner can flip to expose NSFW pieces on their public page. The viewer's preference doesn't override the profile owner's choice — the owner decides what's public.

## Why all this?

Many collectors have mixed shelves — they want a single app to track everything without exposing the NSFW figures to a casual viewer (e.g., when sharing the screen). The three-mode setting + per-figure flag + public-profile gate covers the common scenarios without forcing users to keep two separate apps.
