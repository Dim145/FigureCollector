# Administration

Everything an instance admin manages lives under **`/admin`** — visible only
to accounts with the admin flag. It's a single surface with a sub-nav; this
page maps each section and details the two operational ones (settings and
background tasks).

| Section | What it does |
|---|---|
| **Vue d'ensemble** (`/admin`) | Instance counters and health at a glance. |
| **Utilisateurs** | The account register — roles, activity. |
| **Catalogue · figures** | Moderate the shared figure catalogue. |
| **Catalogue · entités** | Curate the entity tables behind manufacturer / series / character names. |
| **Types de figurines** | The runtime-curated `figure_types` list (replaces a hard-coded enum). |
| **Boutiques** | The stores registry (slug-deduped rows users create implicitly by typing a store name). |
| **Serveurs Manga** | The MangaCollector server allow-list — see [MangaCollector synergy](manga.md). |
| **Notifications** | System-level channel toggles, VAPID keypair generation, test sends — see [Notifications](notifications.md). |
| **Workers** | 360°/gsplat worker fleet: heartbeat status (jade = online, gold = paused, laque = offline), enable/pause. |
| **Tâches** | Scan queue **+ server job history** (below). |
| **Réglages** | Instance policies (below). |

## Réglages (`/admin/settings`)

Instance-wide policies, stored in the `app_settings` table (key/value, no
restart needed):

### 3D model creation policy

`gsplat.creation_policy` — who may launch **gsplat (3D Gaussian splat)**
reconstructions:

- **`admins_only`** (default) — gsplat training is GPU-heavy; new instances
  keep it admin-gated until the operator decides otherwise.
- **`everyone`** — any signed-in user can create 3D scans.

Classic 360° turntable scans are not gated — only the gsplat pipeline.

### Market-price refresh schedule

`cote.price_cron` — a standard **5-field cron expression (UTC)** driving the
[market-price sweep](cote.md#market-prices-auto-tracked) that auto-prices
collections. Empty = disabled (the default). The scheduler re-reads the
setting every minute, so changes apply without a restart; the settings page
shows a live *next run* indicator.

## Tâches (`/admin/tasks`)

Two registers on one page:

**Scan queue** — pending / processing / failed 360° and gsplat jobs, with
retry & cancel controls.

**Server jobs** — every scheduled job run is historized (`server_job_runs`)
and listed newest-first:

| Job | What it does |
|---|---|
| `price_cron` | The market-price sweep (admin-scheduled, above). |
| `release_cron` | Daily pre-order notifications (release today / J-7, delivery today / overdue) + wishlist price alerts piggyback on price runs. |
| `scan_cleanup` | Prunes orphaned scan files. |
| `manga_sync` | Refreshes MangaCollector cross-links. |

Each run records its trigger (*schedule* or *manual*), state
(*processing / ready / failed*), a job-specific **result summary** (e.g.
`{"processed": 127, "updated": 42}`), an error message on failure, and
timestamps. The last **30 runs per job** are retained.

- **Relancer** — every job has a manual-trigger button; the run is recorded
  with `triggered_by = manual` like any other.
- **Crash-safe** — a run left `processing` by a server restart is marked
  *failed (« interrupted by a server restart »)* on boot, so the register
  never shows a phantom forever-running job.

!!! tip "Where do alerts come from?"
    If a user asks why they got (or didn't get) a price alert or a release
    reminder, this page is the audit trail: find the corresponding
    `price_cron` / `release_cron` run and read its result summary.
