# FigureCollector — image-embedding worker

Builds the **visual-search index**: it drains `figure_embedding_queue`, embeds
each catalog image with **DINOv2-small** (384-d) and writes the vector to
`figure_embeddings`, where pgvector's HNSW index serves nearest-neighbour
search. The user's *query* photo is embedded in the browser with the **same
model + preprocessing**, so query and index live in one space.

Unlike the gsplat worker this needs **no GPU** — DINOv2-small (q8) runs on CPU
via onnxruntime. Run it anywhere that can reach the database and the API.

## How it fits

- Registers in the `workers` table with `kind='embed'` and advertises the
  `embed` **capability**. The server only lets an admin (re)build the index
  while at least one live `embed`-capable worker is present
  (`/admin/visual-search/reindex`, surfaced in **Admin → Réglages → Recherche
  par photo**). Querying needs only the feature flag + a populated index.
- Coordination is **direct PostgreSQL** (asyncpg) — same as the gsplat worker,
  no worker→server HTTP control plane.
- Catalog images are fetched over HTTP: `photo` rows via the server's public
  `/api/figure-photos/{uuid}` proxy (storage-agnostic — works with Garage *or*
  the filesystem backend), `official` rows from their source URL.

## Build & run

```sh
docker build -t figurecollector-embed-worker infrastructure/embed-worker

docker run --rm \
  -e DATABASE_URL="postgres://figurecollector:figurecollector@db:5432/figurecollector" \
  -e SERVER_URL="http://server:3000" \
  figurecollector-embed-worker
```

On the project's dev compose network the service can reach `postgres:5432` and
`server:3000` directly. For a remote/standalone deployment, point `DATABASE_URL`
at the database and `SERVER_URL` at the API origin.

### Environment

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — (required) | `postgres://user:pass@host:5432/db` |
| `SERVER_URL` | `http://server:3000` | API base for `photo` fetches |
| `MODEL_PATH` | `/models/dinov2-small/model_quantized.onnx` | baked into the image |
| `POLL_INTERVAL` | `5` | seconds between polls when the queue is empty |
| `HEARTBEAT_INTERVAL` | `30` | liveness ping; server flags offline after 3× |
| `MAX_ATTEMPTS` | `3` | retries before a queue row is marked `failed` |
| `HTTP_TIMEOUT` | `30` | per-image fetch timeout (seconds) |
| `MAX_IMAGE_BYTES` | `26214400` | reject a fetched image larger than this |

### Hardening

The image runs as non-root uid 65532. Pair it with the project's standard
runtime constraints:

```yaml
read_only: true
tmpfs: [ "/tmp:size=64M,noexec,nosuid,nodev" ]
cap_drop: [ ALL ]
security_opt: [ "no-new-privileges:true" ]
```

## Model contract (keep in lockstep)

Query (`client/src/lib/embed.js`) and index (this worker) **must** match:

- model: `Xenova/dinov2-small`, the q8 `model_quantized.onnx`;
- preprocessing: RGB → resize shortest-edge→256 (bicubic) → centre-crop 224² →
  rescale 1/255 → ImageNet mean/std;
- descriptor: CLS token of `last_hidden_state`, L2-normalised;
- `MODEL_VERSION = "dinov2-small/1"` — bump it on **both** sides (and the
  server's `domain::visual_search::MODEL_VERSION`) when the model changes, then
  re-index.
