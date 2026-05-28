# splat-worker-mac

A native **macOS** Gaussian-Splatting worker. Same job and the same
database / Garage / `result.ply` contract as the CUDA [`gsplat-worker`](../gsplat-worker/),
but it trains on the **Apple GPU via Metal** (through [Brush](https://github.com/ArthurBrussee/brush),
which is built on `wgpu`) instead of CUDA.

## Why not Docker?

Docker Desktop on macOS **cannot pass the Metal GPU into a Linux container**, so a
containerised worker on a Mac would be CPU-only — useless for splatting. This
worker therefore runs **on the host** and reaches the dockerised stack through
its published ports (Postgres `localhost:8432`, Garage `localhost:3902`).

> The CUDA `gsplat-worker` is still the right choice for a real NVIDIA GPU host.
> This one is the local/Apple-Silicon alternative — the polling, claiming,
> download, upload and state-machine are identical; only the trainer differs.

## Pipeline

1. Claim the oldest `state='pending' AND kind='gsplat'` scan (`FOR UPDATE SKIP LOCKED`).
2. Get frames into `images/`:
   - if the scan shipped its **original video** (`{prefix}source.*`), ffmpeg
     samples ~`VIDEO_TARGET_FRAMES` full-resolution frames from it (much better
     than the client's downscaled WebP set);
   - otherwise decode the stored WebP frames → PNG.
3. *(optional)* Background-mask the object — see [Capture quality](#capture-quality).
4. **COLMAP** Structure-from-Motion → poses + sparse points. SIFT is cranked
   (more, weaker keypoints) and the mapper is lenient, because glossy / low-texture
   figures yield few features. COLMAP often splits a hard scene into several
   disconnected models (`sparse/0`, `sparse/1`, …); we keep the one with the
   **most registered images**.
5. **Brush** trains a splat on Metal and exports `result.ply`.
6. Upload `result.ply` to Garage and flip the scan to `state='ready'` — which is
   exactly what `/api/scans/{id}/splat` and the front-end `GsplatViewer` expect.

If SfM registers too few frames (< 8) the job fails with a clear message — that
means the capture, not the worker, is the problem (see below).

## Prerequisites

```bash
# 1. COLMAP (Structure-from-Motion)
brew install colmap

# 2. Brush (Gaussian Splatting on Metal). Needs Rust >= 1.88.
#    NB: if you have a github `insteadOf` rewrite (https -> ssh), cargo's libgit2
#    may fail to fetch Brush's git deps — tell cargo to use the git CLI:
git clone --depth 1 https://github.com/ArthurBrussee/brush ~/.cache/fc-brush
cd ~/.cache/fc-brush
CARGO_NET_GIT_FETCH_WITH_CLI=true cargo build --release --bin brush
#    -> binary at ~/.cache/fc-brush/target/release/brush  (the default BRUSH_BIN)

# 3. Python venv for this worker
cd <repo>/infrastructure/splat-worker-mac
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Configure & run

```bash
cp .env.example .env
# fill in S3_ACCESS_KEY / S3_SECRET_KEY (the Garage creds the backend uses)

./run.sh            # foreground
```

To run it as a background service that survives logout/login, use the launchd
**LaunchAgent** (must be an agent, not a daemon — only your GUI session can touch
the GPU):

```bash
# edit the __FC_DIR__ placeholders to this folder's absolute path first
cp com.figurecollector.splat-worker.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.figurecollector.splat-worker.plist
# logs: worker.out.log / worker.err.log in this folder
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `…@localhost:8432/figurecollector` | published Postgres port |
| `S3_ENDPOINT` | `http://localhost:3902` | published Garage S3 port |
| `S3_BUCKET` | `figurecollector` | |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | **required**, Garage creds |
| `S3_REGION` | `garage` | |
| `POLL_INTERVAL` | `10` | seconds between polls when idle |
| `TRAINING_ITERATIONS` | `15000` | Brush `--total-train-iters` |
| `VIDEO_TARGET_FRAMES` | `150` | frames sampled from a source video (if present) |
| `BRUSH_BIN` | `~/.cache/fc-brush/target/release/brush` | the binary you built |
| `COLMAP_BIN` | `colmap` | |
| `ENABLE_MASKING` | `false` | foreground masking (needs `rembg`) |

## Capture quality

The quality ceiling is the **capture**, not the training params. The job is to
give COLMAP enough consistent views to solve accurate camera poses; once the
poses are right, the splat is sharp and more iterations only help. (When the
poses are *wrong*, more iterations make it worse — they grow floaters to explain
the inconsistency. If your splat looks like exploding spikes, that's bad poses,
not too few iterations.)

For a **glossy figurine, Gaussian Splatting is the right tool** — better than
mesh photogrammetry, which breaks on reflective/specular surfaces. Don't switch
engines; fix the capture:

1. **Multiple elevations — the #1 lever.** A single horizontal ring (a fixed
   camera + spinning turntable) can't see the top, bottom, or anything at a
   grazing angle, so those areas (e.g. raised legs, undercuts) stay blurry no
   matter what. Shoot **2–3 passes at different heights** (looking down / level /
   up), a full rotation each, ~70–80% overlap. *Varying the angle matters far
   more than adding frames at the same height.*
2. **Close-ups of problem areas** — a handful of extra shots physically closer to
   the soft regions (legs, face) adds real detail there. (New shots — not digital
   crops, which add no information.)
3. **Capture hygiene** — diffuse, even lighting (no glare); **lock exposure and
   white balance** (auto-exposure drift confuses SfM); avoid motion blur. A
   *spinning-object video* tends to have motion blur + exposure drift, so crisp
   stop-and-shoot stills (or a slow turntable) often beat a video. Every flaw in
   the source becomes a flaw in the splat.
4. **Foreground masking** (`ENABLE_MASKING=true` + `rembg`) — for a turntable,
   masking is mandatory: otherwise SfM locks onto the static background and
   thinks the *object* is moving. The worker bakes alpha into the training images
   (Brush honours it) and feeds COLMAP a mask via `--ImageReader.mask_path`.
   Alternatively, stand the figure on a **patterned mat that rotates with it** so
   SfM has features and you can skip masking.
5. **Feed the original video.** The worker samples ~`VIDEO_TARGET_FRAMES`
   lossless frames from it (capped at `VIDEO_MAX_DIM`), far better than the
   client's downscaled WebP previews. More frames help *only* if they add new
   angles — a denser single ring plateaus quickly.

A dense, multi-frame capture reconstructs cleanly: a 28 s turntable video at
~150 frames registered **150/150** into one model here. The remaining softness is
the single-elevation limit — fixed by item 1, not by more iterations.

## Troubleshooting

- **`Brush binary not found`** — build it (above) or set `BRUSH_BIN`.
- **`COLMAP produced no sparse model`** — SfM failed to register the frames;
  almost always the turntable/background issue → enable masking, or capture with
  more parallax / texture.
- **Brush build fails on a git dependency / SSH auth** — prepend
  `CARGO_NET_GIT_FETCH_WITH_CLI=true` (see prerequisites).
- **COLMAP segfaults during matching** — the Homebrew COLMAP 4.0.4 (no-CUDA)
  *CPU* SIFT matcher crashes; the worker therefore uses the GPU matcher
  (`--FeatureMatching.use_gpu 1`, OpenGL/Metal — no CUDA needed). That path
  needs a window-server connection, so run the worker from your GUI session
  (a terminal, or the launchd **LaunchAgent** — not a LaunchDaemon / ssh
  session). COLMAP also renamed the flags in 4.x: `FeatureExtraction.*` /
  `FeatureMatching.*`, not `SiftExtraction.*` / `SiftMatching.*`.
- **Stuck `processing` after a crash** — reset it:
  ```sql
  UPDATE scans SET state='pending', updated_at=now()
   WHERE state='processing' AND updated_at < now() - INTERVAL '1 hour';
  ```
