# gsplat-worker

Phase 5B sidecar: trains a Gaussian Splatting model from a `scans` row in
`kind = 'gsplat', state = 'pending'`, then writes the `.ply` back to Garage
and flips the row to `state = 'ready'`.

## Requirements

- NVIDIA GPU with ≥8 GB VRAM (12 GB recommended)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) on the host
- Docker Compose ≥ 2.20 (for `deploy.resources.reservations.devices`)

## Build

```bash
docker compose -f docker-compose.yml -f docker-compose.gsplat.yml build gsplat-worker
```

The image is **rebased on the official Nerfstudio image**
(`ghcr.io/nerfstudio-project/nerfstudio`), which already ships a **CUDA-built
COLMAP**, the `ns-*` CLIs, gsplat, tinycudann, hloc and ffmpeg. We only layer the
worker's runtime deps on top, so the build is quick (no torch/nerfstudio/gsplat
compile). Pin the base for reproducibility:
`--build-arg NERFSTUDIO_IMAGE=ghcr.io/nerfstudio-project/nerfstudio:<tag>`.

Because COLMAP is built with CUDA, feature extraction + matching run **on the
GPU, headless** (`COLMAP_USE_GPU=true`, the default) — no X server / Xvfb. The
COLMAP 4.x mapper runs on CPU (Ceres); the splat training runs on the GPU via
**CUDA gsplat** (the rasteriser splatfacto builds on — no Vulkan). Read the
`gpu: …` lines the worker logs at startup — they report the CUDA device that
runs COLMAP SIFT, rembg and gsplat training.

## Run

The worker is wired in `docker-compose.gsplat.yml` as an overlay; activate it
on top of the main compose:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.gsplat.yml \
  up -d gsplat-worker
```

Logs:

```bash
docker compose logs -f gsplat-worker
```

## Pipeline

1. **Claim** the oldest pending gsplat scan (atomic `FOR UPDATE SKIP LOCKED`).
2. **Get frames** into a temporary directory:
   - if the scan shipped its **original video** (`{prefix}source.*`), ffmpeg
     samples ~`VIDEO_TARGET_FRAMES` full-resolution frames from it (much better
     than the client's downscaled WebP set);
   - otherwise decode the stored WebP frames to PNG.
3. *(default on)* **Foreground masks** — when `ENABLE_MASKING=true`, `rembg`
   segments each frame **on the GPU** (`onnxruntime-gpu` / CUDA EP, logged per
   scan; degrades to CPU if it can't bind) into two binary mask sets from one
   pass (the frames stay clean RGB): COLMAP's `mask_path` form (SfM tracks the
   figure) and the trainer's per-frame loss masks. Best-effort.
4. **SfM** — COLMAP feature extraction + **sequential** matching on the GPU (the
   image's CUDA COLMAP 3.9.1; many weak SIFT features + `mask_path` so SfM tracks
   the figure, not the static backdrop), then the **COLMAP 4.x** incremental
   mapper (from a conda-forge micromamba env) — *not* the image's 3.9.1 mapper,
   which is multi-threaded non-deterministic (the same capture gave 2/100 frames
   one run and 100/100 the next). COLMAP 4.0's reworked mapper is what the macOS
   Homebrew COLMAP runs. Keeps the largest sub-model; fails with an actionable
   message if fewer than 10 frames register.
5. **gsplat MCMC** (`gsplat_mcmc.py`, pure CUDA) trains the Gaussian splat from
   the COLMAP dataset (`images/` + `sparse/0`). The MCMC strategy caps the
   Gaussian count (`GSPLAT_CAP_MAX`) and *relocates* low-opacity Gaussians
   instead of letting them linger, and the per-frame loss masks make the
   background contribute zero loss — together that's the haze fix. Runs as a
   subprocess (VRAM freed on exit) for `TRAINING_ITERATIONS` iters at up to
   `GSPLAT_MAX_RES` px, and writes the `.ply` directly.
6. **Upload** the `.ply` back to Garage at `scans/{scan_id}/result.ply`.
7. **Mark** the scan `state='ready', result_key=…`.

If anything fails, the scan is set to `state='failed'` with the truncated
traceback in `error_message`.

> This worker shares the macOS [`splat-worker-mac`](../splat-worker-mac/)
> front-end end to end — same ffmpeg sampling, tuned SIFT extraction +
> `mask_path`, sequential matching, and the **same COLMAP 4.x incremental
> mapper** (conda-forge here, Homebrew on the Mac) — but trains differently: the
> Mac uses Brush (wgpu→Metal), while here we train with **CUDA gsplat (MCMC)**,
> since Brush's Vulkan backend can't initialise the host's 575 driver in-container.

## Tunables

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | required, points at the same PG the backend uses |
| `S3_ENDPOINT` | — | required, Garage S3 API (e.g. `http://garage:3902`) |
| `S3_BUCKET` | — | required |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | required |
| `S3_REGION` | `garage` | matches the value in `infrastructure/garage/garage.toml` |
| `POLL_INTERVAL` | `10` | seconds between polls when the queue is empty |
| `TRAINING_ITERATIONS` | `30000` | gsplat MCMC training iterations (30k standard; 15k faster/softer) |
| `VIDEO_TARGET_FRAMES` | `150` | frames sampled from a source video (if present) |
| `VIDEO_MAX_DIM` | `2048` | max-dim cap on extracted frames |
| `COLMAP_MAX_FEATURES` | `8192` | SIFT features/image; 8192 ~halves matching + the CPU mapper vs 16384 with no quality loss on glossy turntables (the main mapper-speed lever — GPU BA doesn't help at ~150 imgs); bump to 16384 if registration drops |
| `GSPLAT_CAP_MAX` | `250000` | MCMC Gaussian cap — the dominant VRAM lever (MCMC grows to the cap, then holds it); lower on OOM, raise for more detail |
| `GSPLAT_MAX_RES` | `1600` | longest image side the trainer renders — the other VRAM lever; raise for sharper results if VRAM allows |
| `ENABLE_MASKING` | `true` | rembg-mask the figure (one pass) → COLMAP `mask_path` (SfM tracks the figure, essential on a turntable) + per-frame loss masks (background contributes zero loss → no haze) |

## Recovering a stuck scan

If the worker crashes mid-job, the row stays in `state='processing'`. Reset
with:

```sql
UPDATE scans SET state='pending', updated_at=now()
 WHERE state='processing' AND updated_at < now() - INTERVAL '1 hour';
```

(A heartbeat column + automatic reset is on the wishlist; for now this is
manual.)
