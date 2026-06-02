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
3. *(default on)* **Foreground masks** — when `ENABLE_MASKING=true`, `rembg`
   segments each frame **on the GPU** (`onnxruntime-gpu` / CUDA EP, logged per
   scan; degrades to CPU if it can't bind) into two mask sets: COLMAP's
   `mask_path` form and nerfstudio's per-frame masks. Best-effort.
4. **COLMAP SfM** — ported from the macOS worker and tuned for glossy /
   low-texture figures on a turntable: feature extraction with many weak SIFT
   features + `mask_path` (so SfM tracks the figure, not the static backdrop),
   **sequential** matching on the ordered video frames, a lenient mapper, then
   keep the largest registered sub-model. Fails with an actionable message if
   fewer than 10 frames register (instead of letting splatfacto crash on a
   degenerate model).
5. **`ns-train splatfacto`** via the **`colmap` dataparser** (reads the COLMAP
   model + images + masks directly) — `TRAINING_ITERATIONS` iters (default 30000,
   ~20-40 min on a 3050/3060), with `--pipeline.model.use-scale-regularization
   True` to suppress long "needle" gaussians, and the masks fed to the loss so
   the background never accretes gaussians (no plane, no floater halo).
6. **`ns-export gaussian-splat`** — writes the trained splat as `.ply`.
7. **Upload** the `.ply` back to Garage at `scans/{scan_id}/result.ply`.
8. **Mark** the scan `state='ready', result_key=…`.

If anything fails, the scan is set to `state='failed'` with the truncated
traceback in `error_message`.

> This worker now mirrors the macOS [`splat-worker-mac`](../splat-worker-mac/)
> end to end: same ffmpeg frame sampling, the **same tuned COLMAP recipe** (16k
> features, `mask_path`, sequential matching, lenient mapper, largest-model), and
> the same source-of-truth object key (`{prefix}source.*`). Only the trainer
> differs — splatfacto here, Brush on the Mac.

## Tunables

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | required, points at the same PG the backend uses |
| `S3_ENDPOINT` | — | required, Garage S3 API (e.g. `http://garage:3902`) |
| `S3_BUCKET` | — | required |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | required |
| `S3_REGION` | `garage` | matches the value in `infrastructure/garage/garage.toml` |
| `POLL_INTERVAL` | `10` | seconds between polls when the queue is empty |
| `TRAINING_ITERATIONS` | `30000` | splatfacto `max-num-iterations` (matches the macOS worker; `stop_split_at` is 15000, so this gets the full densify-then-refine schedule) |
| `VIDEO_TARGET_FRAMES` | `150` | frames sampled from a source video (if present) |
| `VIDEO_MAX_DIM` | `2048` | max-dim cap on extracted frames |
| `ENABLE_MASKING` | `true` | rembg-mask the figure → COLMAP `mask_path` (SfM tracks the figure, essential on a turntable) + splatfacto loss mask (drops the background) |

## Recovering a stuck scan

If the worker crashes mid-job, the row stays in `state='processing'`. Reset
with:

```sql
UPDATE scans SET state='pending', updated_at=now()
 WHERE state='processing' AND updated_at < now() - INTERVAL '1 hour';
```

(A heartbeat column + automatic reset is on the wishlist; for now this is
manual.)
