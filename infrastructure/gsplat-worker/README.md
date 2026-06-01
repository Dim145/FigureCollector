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
GPU, headless** (`COLMAP_USE_GPU=true`, the default) — no X server / Xvfb. Only
the COLMAP mapper + the splat training's CPU glue remain on CPU; the heavy work
(SIFT on GPU, `ns-train splatfacto` on GPU) is GPU-bound. Verify with
`nvidia-smi` during the `ns-process-data` step, or read the `gpu: …` lines the
worker logs at startup.

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
3. *(optional)* **Background-mask** the object with `rembg` when
   `ENABLE_MASKING=true`. Mandatory for turntable captures — without it
   COLMAP locks onto the static backdrop and the splat fits the void.
4. **`ns-process-data images`** — runs COLMAP feature extraction, matching, and
   sparse reconstruction → produces a Nerfstudio-shaped dataset.
5. **`ns-train splatfacto`** — Gaussian Splatting training,
   `TRAINING_ITERATIONS` iterations (default 15000, ~10-20 minutes on a 3060).
6. **`ns-export gaussian-splat`** — writes the trained splat as `.ply`.
7. **Upload** the `.ply` back to Garage at `scans/{scan_id}/result.ply`.
8. **Mark** the scan `state='ready', result_key=…`.

If anything fails, the scan is set to `state='failed'` with the truncated
traceback in `error_message`.

> The video-direct path keeps this worker behaviourally aligned with the
> macOS [`splat-worker-mac`](../splat-worker-mac/): same env defaults
> (`VIDEO_TARGET_FRAMES=150`, `VIDEO_MAX_DIM=2048`), same source-of-truth
> object key (`{prefix}source.*`).

## Tunables

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | required, points at the same PG the backend uses |
| `S3_ENDPOINT` | — | required, Garage S3 API (e.g. `http://garage:3902`) |
| `S3_BUCKET` | — | required |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | required |
| `S3_REGION` | `garage` | matches the value in `infrastructure/garage/garage.toml` |
| `POLL_INTERVAL` | `10` | seconds between polls when the queue is empty |
| `TRAINING_ITERATIONS` | `15000` | splatfacto `max-num-iterations` |
| `VIDEO_TARGET_FRAMES` | `150` | frames sampled from a source video (if present) |
| `VIDEO_MAX_DIM` | `2048` | max-dim cap on extracted frames |
| `ENABLE_MASKING` | `false` | bake rembg foreground masks into the training PNGs |

## Recovering a stuck scan

If the worker crashes mid-job, the row stays in `state='processing'`. Reset
with:

```sql
UPDATE scans SET state='pending', updated_at=now()
 WHERE state='processing' AND updated_at < now() - INTERVAL '1 hour';
```

(A heartbeat column + automatic reset is on the wishlist; for now this is
manual.)
