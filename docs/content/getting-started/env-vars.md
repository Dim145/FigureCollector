# Environment variables

Exactly one variable is **required** — the backend refuses to start without it.
Everything else has a sensible default or quietly disables its feature.
The authoritative sources are `server/src/config.rs` (the API) and the worker
scripts (`infrastructure/embed-worker/embed_index.py` +
`infrastructure/gsplat-worker/{worker,gsplat_mcmc}.py` for the
[Workers](#workers-indexing-3d) below).

## Required

| Variable | What |
|---|---|
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://figurecollector:…@postgres:5432/figurecollector` |

!!! note "No session secret"
    Sessions are server-side rows in Postgres (`tower-sessions`), so there is
    no `SESSION_SECRET` to generate or rotate.

## Core

| Variable | Default | What |
|---|---|---|
| `FC_BIND_ADDR` | `0.0.0.0:3000` | HTTP listen address of the backend. |
| `FRONTEND_URL` | `http://localhost:5173` | Canonical public URL of the SPA — drives OIDC redirects and the session cookie's `Secure` flag (on for `https://`, off for plain-HTTP dev). |
| `FC_COOKIE_INSECURE` | derived from `FRONTEND_URL` | Force-disable the `Secure` cookie flag (only for odd plain-HTTP setups behind TLS-terminating proxies). |

## Authentication

Local username/password sign-in (Argon2id) is always available; OIDC providers
appear automatically once their credentials are set.

| Variable | Default | What |
|---|---|---|
| `ALLOW_LOCAL_SIGNUP` | `true` | Allow self-service account creation. Set `false` for an OIDC-only (or invite-by-admin) instance. |
| `OIDC_GOOGLE_CLIENT_ID` / `OIDC_GOOGLE_CLIENT_SECRET` | — | Enable the Google sign-in button. |
| `OIDC_GOOGLE_ISSUER_URL` | `https://accounts.google.com` | Rarely changed. |
| `OIDC_GOOGLE_DISPLAY_NAME` | `Google` | Button label. |
| `OIDC_GOOGLE_SCOPES` | `openid,email,profile` | Comma-separated. |
| `OIDC_GENERIC_CLIENT_ID` / `OIDC_GENERIC_CLIENT_SECRET` | — | Enable a generic OIDC provider (Authelia, Keycloak, Authentik, …). |
| `OIDC_GENERIC_ISSUER_URL` | — | **Required** when the generic provider is enabled. |
| `OIDC_GENERIC_DISPLAY_NAME` | `Single sign-on` | Button label. |
| `OIDC_GENERIC_SCOPES` | `openid,email,profile` | Comma-separated. |
| `OIDC_REDIRECT_BASE` | `FRONTEND_URL` | Base of the OIDC callback URL — override only when the API is reachable on a different origin than the SPA. |

## Storage

If unset, uploads fall back to the local filesystem under `./data/uploads`.

| Variable | Default | What |
|---|---|---|
| `S3_ENDPOINT` | — | e.g. `http://garage:3902` |
| `S3_REGION` | `garage` | S3 region tag |
| `S3_BUCKET` | `figurecollector` | Bucket name |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Garage / S3 credentials |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style URLs (required by Garage) |

## External metadata

| Variable | What |
|---|---|
| `FIGURE_PROXY_URL` | Base URL of the boutique-scraping proxy (no trailing slash). When unset, the `/api/external/proxy/*` routes return `feature_disabled` and the SPA hides the proxy lookup UI. Also powers the [market-price sweep](../features/cote.md) for non-orzgk boutiques. See [URL import](../features/url-import.md). |
| `FIGURE_PROXY_API_KEY` | Optional bearer token sent on every proxy call. |
| `FIGURE_PROXY_TIMEOUT_SECS` | Default `60`. Wall-clock cap (seconds) on a single proxy call — raise it if a slow proxy (Cloudflare warm-ups, paginated scrapes) makes searches error out. |

### Owned-photo tagging

| Variable | What |
|---|---|
| `WORKER_INTERNAL_TOKEN` | Shared secret that lets the embed worker read **private (owned-item) photos** to tag them — gates [owned-photo tagging](../features/visual-search.md#tag-your-own-photos). Set it equal to the worker's `EMBED_WORKER_TOKEN`; generate with `openssl rand -hex 32`. **Unset = the feature stays off** — the internal fetch route (`/api/internal/*`) fail-closes, and nginx `404`s that path from outside. Catalogue-only search (which reads shared images) doesn't need it. |

!!! note "AI search & tagging are admin-gated"
    Semantic (*Description*), appearance (*Apparence*/SigLIP), photo recognition,
    recommendations, and owned-photo tags are all **admin-toggle features, off by
    default** — enable them in **Réglages admin** and run the embed worker to
    index. See [Photo search](../features/visual-search.md#admin) for the worker;
    the worker's own knobs (`EMBED_*`, `SERVER_URL`) are under
    [Indexing worker](#indexing-worker-embed-worker) below.

### Circuit breaker

After repeated failures from an external source (orzgk or the proxy — typically
a rate-limit `403`), the breaker pauses that source and fails its calls fast
(`503`, with a clear "en pause" message) instead of hammering it; the first call
after the pause is a trial that closes the breaker on success. One counter per
source, shared across all its endpoints.

| Variable | Default | What |
|---|---|---|
| `EXTERNAL_BREAKER_THRESHOLD` | `5` | Consecutive errors from one source before it's paused. |
| `EXTERNAL_BREAKER_PAUSE_SECS` | `300` | Seconds a paused source stays paused before the trial call. |

## Parcel tracking

Best-effort carrier lookups for shipped pre-orders — each key enables its
carrier, missing keys simply hide it.

| Variable | Carrier |
|---|---|
| `COLISSIMO_API_KEY` | La Poste / Colissimo |
| `DHL_API_KEY` | DHL |
| `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET` | UPS (OAuth2) |

!!! note "Notifications are configured in the app, not here"
    SMTP credentials, the Web-Push VAPID keypair, and ntfy defaults are all
    managed by the admin **in the UI** (*Administration → Notifications*) and
    stored in the database — there are no `SMTP_*` / `VAPID_*` environment
    variables. See [Notifications](../features/notifications.md).

## Rate limiting

The built-in rate limiter (tower_governor) guards the auth routes
(`/api/auth/*`) — login / register / OIDC callbacks — keyed by client
IP. It does **not** touch the rest of the API.

| Variable | Default | What |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | Master switch. Set to `false`/`0`/`no`/`off` to remove the limiter entirely — do this when you front the app with your own limiter (Traefik, Cloudflare) or when the defaults are too tight for your OIDC bursts. |
| `AUTH_RATE_LIMIT_PER_SECOND` | `2` | Sustained requests/second allowed per IP on auth routes. |
| `AUTH_RATE_LIMIT_BURST` | `8` | Burst allowance on top of the sustained rate. |

!!! note "429 on the 360° viewer"
    The turntable viewer used to fire every frame request at once, which
    could trip an *upstream* limiter (your reverse proxy / host) — never
    the built-in one above, which is auth-only. The viewer now loads
    frames with bounded concurrency + per-frame retry, and surfaces a
    "retry" button if frames still fail, so a transient 429 no longer
    leaves a hole in the rotation.

## Housekeeping & observability

| Variable | Default | What |
|---|---|---|
| `GSPLAT_KEEP_COMPLETED` | `5` | How many successful gsplat scans to keep **per figurine** — older ones (rows + blobs) are pruned by the `scan_cleanup` job. Floored at 1. |
| `RUST_LOG` | `info` | Set to `debug` for chatty logs. |

## Cache

A small cache-aside layer accelerates the heavy per-user aggregates
(`/me/stats`, `/me/insights`, `/me/price-history`); the keys are dropped the
moment the user changes their collection, so reads stay fresh. The default
in-process backend is **per-replica** — correct for a single instance; a shared
backend (Redis) can be slotted in later (implement the `CacheStore` trait + one
factory arm) without touching call sites, which is what makes the cache correct
across multiple replicas.

| Variable | Default | What |
|---|---|---|
| `CACHE_BACKEND` | `memory` | `memory` (in-process, per-replica) or `off` (caching disabled). `redis` / `memcached` are reserved for a future shared backend — needed only when running several backend replicas. |
| `CACHE_MAX_ENTRIES` | `10000` | Max entries the in-process (`memory`) backend holds before LRU eviction. |

## Workers (indexing & 3D)

These apply to the optional **worker containers**, not the API:

- **embed-worker** — builds the photo / semantic / appearance search indexes
  (DINOv2, e5, SigLIP, WD-Tagger). CPU-only standalone image, or folded into the
  gsplat worker. Reaches figures over HTTP via `SERVER_URL`.
- **gsplat-worker** — turns a turntable video into a 3D Gaussian splat
  (COLMAP SfM → gsplat training). NVIDIA GPU. Reads/writes blobs in S3 directly.

Both read `DATABASE_URL`. The gsplat worker also needs the same `S3_*` as the
API (above); the embed worker fetches images through `SERVER_URL` instead. Every
variable below has a safe default — set them in the worker service's
`environment:`.

### Indexing worker (embed-worker)

| Variable | Default | What |
|---|---|---|
| `SERVER_URL` | `http://server:3000` | Backend base URL the worker pulls figures/images from and reports status to. |
| `EMBED_WORKER_TOKEN` | — | Bearer token the worker sends to read **private owned photos** for [owned-photo tagging](../features/visual-search.md#tag-your-own-photos). Must equal the server's [`WORKER_INTERNAL_TOKEN`](#owned-photo-tagging). Unset = the worker skips owned-photo tagging (the rest of the indexing still runs). |
| `EMBED_DEVICE` | `cpu` | `cpu`, `cuda` (needs onnxruntime-gpu — bundled only in the gsplat image), or `auto`. CPU suits typical catalogs; CUDA indexes much faster on a worker with spare VRAM. |
| `EMBED_MODEL_IDLE_GRACE` | `300` | Seconds a model stays in RAM after its last use before unloading (reloads on demand). `0` = unload as soon as the queue drains. |
| `EMBED_POLL_INTERVAL` | `5` | Seconds between queue polls when idle. |
| `EMBED_MAX_ATTEMPTS` | `3` | Retries before a queue item is marked failed. |
| `EMBED_HTTP_TIMEOUT` | `30` | Per-request timeout (s) for image / API fetches. |
| `EMBED_MAX_IMAGE_BYTES` | `26214400` (25 MiB) | Skip images larger than this. |
| `EMBED_TEXT_MAX_TOKENS` | `512` | Max tokens for the e5 passage embedding. |
| `EMBED_TAGGER_GENERAL_THRESHOLD` | `0.35` | WD-Tagger confidence floor for general tags. |
| `EMBED_TAGGER_CHARACTER_THRESHOLD` | `0.5` | WD-Tagger confidence floor for character tags. |
| `EMBED_TAGGER_MAX_GENERAL` | `25` | Max general tags kept per image. |
| `EMBED_TAGGER_MAX_IMAGES` | `10` | Max images tagged per figure (photos + official), then merged. |

Model file paths — baked into the image at fixed locations, change only if you
relocate the models: `EMBED_MODEL_PATH`, `EMBED_MODEL_PATH_FP16`,
`EMBED_TEXT_MODEL_PATH`, `EMBED_TEXT_TOKENIZER_PATH`, `EMBED_CLIP_MODEL_PATH`,
`EMBED_TAGGER_MODEL_PATH`, `EMBED_TAGGER_TAGS_PATH`.

### 3D worker (gsplat-worker) — pipeline

| Variable | Default | What |
|---|---|---|
| `POLL_INTERVAL` | `10` | Seconds between scan-queue polls. |
| `HEARTBEAT_INTERVAL` | `30` | Heartbeat period; the API flags the worker offline after 3× this (~90 s). |
| `RECOVER_ABANDONED` | `true` | At boot, re-queue scans this worker left mid-job on a restart. |
| `TRAINING_ITERATIONS` | `30000` | gsplat training steps (quality vs time). |
| `VIDEO_TARGET_FRAMES` | `150` | Frames extracted from the source video for SfM. |
| `VIDEO_OVERSAMPLE` | `3` | Oversample factor before sharpest-frame selection. |
| `FRAME_SHARP_SELECT` | `true` | Keep the sharpest frame per time bucket (drops motion blur). |
| `VIDEO_MAX_DIM` | `2048` | Cap the longest side of extracted frames. |
| `FFMPEG_USE_GPU` | `true` | Decode the video on the GPU (NVDEC); falls back to CPU. |
| `ENABLE_MASKING` | `true` | Mask the background (rembg) so SfM + training ignore the turntable backdrop. |
| `REMBG_MODEL` | `isnet-general-use` | rembg segmentation model (must be baked into the image). |
| `COLMAP_USE_GPU` | `true` | COLMAP SIFT extraction + matching on the GPU. |
| `COLMAP_BA_USE_GPU` | `false` | Try GPU bundle adjustment (rarely worth it under ~1500 images). |
| `COLMAP_MAX_FEATURES` | `8192` | SIFT features per image. |
| `SFM_FEATURES` | `sift` | `sift`, or `aliked` (learned features + LightGlue; better on glossy/low-texture surfaces — models must be baked). |
| `ALIKED_MAX_FEATURES` | `4096` | ALIKED features per image (when `SFM_FEATURES=aliked`). |
| `SFM_MAPPER` | `incremental` | `incremental`, or `global` (GLOMAP — solves the whole turntable at once). |
| `GLOMAP_MIN_VIEWS_PER_TRACK` | `0` | Global-mapper track filter; try `4`–`5` only if it collapses to a "cube". |
| `COLMAP_MODELS_DIR` | `/opt/colmap-models` | Where baked ALIKED / LightGlue models live. |
| `GSPLAT_CAP_MAX` | `250000` | MCMC Gaussian cap — the dominant VRAM lever (250 k fits a figure on ~6 GB). |
| `GSPLAT_MAX_RES` | `1600` | Longest image side trained on (the other VRAM lever). |
| `GSPLAT_UNDISTORT` | `true` | Undistort to a pinhole dataset before training. |

`CUDA_VERSION` is set by the CUDA base image (informational) — you don't set it.

### 3D worker — advanced quality tuning

Trainer + cleanup knobs (see `gsplat_mcmc.py`), tuned for a small single object
on a turntable. Touch these only to chase a specific artifact; any cleanup
threshold set to `0` disables that filter.

| Variable | Default | What |
|---|---|---|
| `GSPLAT_SH_DEGREE` | `3` | Spherical-harmonics degree (view-dependent colour). `2` cuts specular smear + VRAM. |
| `GSPLAT_NOISE_LR` | `2e5` | MCMC relocation noise; lower lets the figure "set" sharper. |
| `GSPLAT_OPACITY_REG` | `0.01` | Opacity regulariser. |
| `GSPLAT_SCALE_REG` | `0.01` | Scale regulariser. |
| `GSPLAT_ANISO_REG` | `0.01` | Penalise needle-like gaussians ("spike" artifacts); `0` disables. |
| `GSPLAT_ANISO_MAX` | `10.0` | Anisotropy ratio the regulariser targets. |
| `GSPLAT_POSE_OPT` | `true` | Optimise camera poses during training (sharper). |
| `GSPLAT_ANTIALIAS` | `true` | Mip-Splatting antialiased rasterisation. |
| `GSPLAT_BILGRID` | `false` | Bilateral-grid appearance correction (opt-in). |
| `GSPLAT_MASK_LAMBDA` | `0` | Alpha/mask loss weight; enable (`0.1`–`0.3`) only with clean masks. |
| `GSPLAT_RANDOM_BKGD` | `false` | Random-background compositing to kill semi-transparent floaters. |
| `GSPLAT_NEAR` / `GSPLAT_FAR` | `0.01` / scene-derived | Depth planes. |
| `GSPLAT_MIN_OPACITY` | `0.08` | Prune gaussians below this opacity. |
| `GSPLAT_SCALE_PCTL` | `99.5` | Drop the largest-scale tail (percentile). |
| `GSPLAT_SCALE_CAP_FRAC` | `0` (off) | Drop any axis larger than this fraction of the figure radius. |
| `GSPLAT_ANISO_CAP` | `12.0` | Drop needle gaussians above this anisotropy. |
| `GSPLAT_CONTRIB_PCTL` | `1.0` | Drop the lowest opacity·area contributors (percentile). |
| `GSPLAT_SOR_K` / `GSPLAT_SOR_STD` | `20` / `2.0` | Statistical outlier removal: neighbour count, std-dev threshold. |
| `GSPLAT_CROP_TO_FIGURE` | `false` | Crop the cloud to the figure bounding box. |
| `GSPLAT_CROP_PCTL` / `GSPLAT_CROP_MARGIN` / `GSPLAT_CROP_PAD` | `0.98` / `1.5` / `0.15` | Bounding-box percentile, margin and padding for the crop. |
| `GSPLAT_PRUNE_DEBUG` | `false` | Log each cleanup filter's incremental drop count. |

---

## Where they go

- **Development**: `server/.env` (loaded by `dotenvy`).
- **Production**: `.env.prod` consumed by `docker-compose.prod.yml --env-file`. Never commit this file.
- **Workers**: the [worker variables](#workers-indexing-3d) go in the worker
  service's `environment:` in your compose (e.g. `docker-compose.gsplat.yml`) —
  they don't read the API's `server/.env`.
- **CI**: GitHub Actions secrets — `gh secret set NAME` from the repo root.

Environment changes need a container restart — unlike the
[admin settings](../features/admin.md), which apply live.
