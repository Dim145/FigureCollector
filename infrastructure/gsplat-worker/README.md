# gsplat-worker

Phase 5B sidecar: trains a Gaussian Splatting model from a `scans` row in
`kind = 'gsplat', state = 'pending'`, then writes the `.ply` back to Garage
and flips the row to `state = 'ready'`.

## Requirements

- NVIDIA GPU with ≥6 GB VRAM (8+ GB recommended); driver new enough for CUDA 12.x
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) on the host
- Docker Compose ≥ 2.20 (for `deploy.resources.reservations.devices`)

## Build

```bash
docker compose -f docker-compose.yml -f docker-compose.gsplat.yml build gsplat-worker
```

The image is built on the **tiny CUDA 12.9 `-base` image**
(`nvidia/cuda:12.9.2-base-ubuntu22.04`, ~140 MB — just cudart + env) — we dropped
the ~15 GB Nerfstudio base (we only used a few pieces of it, and its COLMAP was
the wrong version). Everything targets **CUDA 12**:
- **torch 2.4.1 + cu124** and **gsplat 1.5.3** (the prebuilt `pt24cu124` wheel — no
  compile, kernels baked in so the read-only container never JITs). Python is
  pinned to **3.10**, the only interpreter gsplat ships a wheel for.
- **onnxruntime-gpu** (CUDA 12) for rembg. The CUDA math libs (cuDNN, cuBLAS,
  cuFFT…) are **reused from torch's bundle** (registered with ldconfig), so we
  take the tiny `-base` image instead of `-runtime`/`-cudnn-runtime`: CUDA ships
  **once**, not twice (~2 GB saved).
- **COLMAP 4.0.4** (conda-forge, CUDA `cuda_129` build) for SfM — see below.

Override the base with `--build-arg CUDA_IMAGE=…`.

**Structure-from-Motion uses COLMAP 4.0.4** (pinned from conda-forge, the CUDA
build — the same version Homebrew installs on the macOS worker, and the reason
that worker reconstructs glossy turntables reliably: COLMAP 4.0's reworked
incremental mapper). Feature extraction + matching run on the **GPU** by default
(`COLMAP_USE_GPU=true`); the incremental mapper is CPU (Ceres) unless
`COLMAP_BA_USE_GPU=true`. rembg and the gsplat MCMC training are GPU too (**CUDA
gsplat** — no Vulkan). Base and conda COLMAP are both CUDA 12.9. Read the `gpu: …`
startup lines.

> Caveat: COLMAP's CUDA SIFT *extraction* is non-deterministic (GPU float
> atomics). If a glossy turntable flaps between a full reconstruction and a
> 2-frame stub, set `COLMAP_USE_GPU=false` (no rebuild) — that forces CPU
> extraction + matching, which is exactly what the macOS worker does on purpose.

> Note: two conda-forge gotchas the Dockerfile works around. (1) `colmap=*=cpu*`
> silently resolves to 3.11.1, not 4.x — so we pin `colmap=4.0.4=cuda_*`. (2) The
> colmap 4.0.4 recipe links `libfaiss.so` but forgets to declare it, so we install
> `libfaiss` ourselves (`cpu_openblas` build) or colmap won't even start.

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
   (model **`isnet-general-use`** — ISNet/DIS 2022, crisper than u2net and fits a
   6 GB card; `REMBG_MODEL`, baked into the image. BiRefNet is higher quality but
   OOMs 6 GB at 1024²) segments each frame **on the GPU** (`onnxruntime-gpu` / CUDA
   EP, logged per scan), **falling back to CPU** if the GPU OOMs — so a turntable
   is never silently left unmasked. One pass writes two binary mask sets (frames
   stay clean RGB): COLMAP's `mask_path` form (SfM tracks the figure) and the
   trainer's per-frame loss masks. Best-effort.
4. **SfM** — **COLMAP 4.0.4** from the conda `sfm` env (CUDA build): GPU feature
   extraction (many weak SIFT features + `mask_path` so SfM tracks the figure,
   not the static backdrop) → **sequential** matching (both on GPU unless
   `COLMAP_USE_GPU=false`) → the CPU incremental mapper (GPU bundle adjustment if
   `COLMAP_BA_USE_GPU=true`). COLMAP 4.0's reworked mapper — the one Homebrew
   installs on the working Mac — is what makes glossy turntables reliable (the
   conda `=cpu*` glob silently resolved to 3.11.1, which is not it). Keeps the
   largest sub-model; fails with an actionable message if fewer than 10 frames
   register. *If a capture flaps to a 2-frame stub, GPU SIFT non-determinism is
   the cause → `COLMAP_USE_GPU=false`.*
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
> front-end end to end — same ffmpeg sampling and the **same COLMAP 4.0.4** with
> the same tuned SIFT extraction + `mask_path` + sequential matching (conda-forge
> here, Homebrew on the Mac) — but trains differently: the Mac uses Brush
> (wgpu→Metal), while here we train with **CUDA gsplat (MCMC)**, since Brush's
> Vulkan backend can't initialise the host's 575 driver in-container.

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
| `COLMAP_MAX_FEATURES` | `8192` | SIFT features/image; 8192 ~halves matching + the mapper's bundle adjustment vs 16384 with no quality loss on glossy turntables; bump to 16384 if registration drops |
| `COLMAP_USE_GPU` | `true` | GPU COLMAP SIFT extraction + matching (CUDA build of 4.0.4). `false` forces CPU (deterministic, slower) — use it if a glossy turntable flaps to a 2-frame stub |
| `COLMAP_BA_USE_GPU` | `false` | GPU bundle adjustment in the mapper (`--Mapper.ba_use_gpu`). Rarely helps at ~150 frames (only pays off ~1500+ images, often slower); falls back to CPU if Ceres lacks CUDA |
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
