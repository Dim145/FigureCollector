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

The first build takes ~15-20 minutes — Nerfstudio + gsplat compile a few CUDA
kernels from source. Subsequent builds reuse the cached layer unless deps move.

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
2. **Download** all frames from Garage to a temporary directory.
3. **`ns-process-data images`** — runs COLMAP feature extraction, matching, and
   sparse reconstruction → produces a Nerfstudio-shaped dataset.
4. **`ns-train splatfacto`** — Gaussian Splatting training,
   `TRAINING_ITERATIONS` iterations (default 15000, ~10-20 minutes on a 3060).
5. **`ns-export gaussian-splat`** — writes the trained splat as `.ply`.
6. **Upload** the `.ply` back to Garage at `scans/{scan_id}/result.ply`.
7. **Mark** the scan `state='ready', result_key=…`.

If anything fails, the scan is set to `state='failed'` with the truncated
traceback in `error_message`.

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

## Recovering a stuck scan

If the worker crashes mid-job, the row stays in `state='processing'`. Reset
with:

```sql
UPDATE scans SET state='pending', updated_at=now()
 WHERE state='processing' AND updated_at < now() - INTERVAL '1 hour';
```

(A heartbeat column + automatic reset is on the wishlist; for now this is
manual.)
