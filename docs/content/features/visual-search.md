# Photo search

Photograph a figure and FigureCollector finds the matching catalog entry —
useful when you have the piece in hand but not its name. It's an alternative to
[URL import](url-import.md) and manual entry, never a replacement: manual entry
is always one tap away.

```
📷  your photo ──► [browser] DINOv2 embedding ──► 384-number signature
                                                        │
                                          ┌─────────────┘
                                          ▼
                              [server] pgvector nearest-neighbour
                                          ▼
                              ranked catalog candidates  ──►  you confirm
```

## How it works

When you open **Reconnaître par photo** and take (or pick) a photo:

1. The image is turned into a **384-number visual fingerprint right in your
   browser**, using the DINOv2-small model (loaded once, then cached). The
   photo itself **never leaves your device** — only the anonymous fingerprint
   is sent.
2. The server compares that fingerprint against the catalog index with
   pgvector's nearest-neighbour search and returns the closest figures, each
   with a similarity score.
3. You pick the right one (or tap through to add it by hand if none fit).

!!! note "Why a fingerprint and not the photo"
    The fingerprint is a one-way summary — it can't be turned back into your
    picture. Keeping the embedding in the browser means the in-catalog search
    is private by construction; the only time an actual image is uploaded is the
    optional web fallback below, and only when you explicitly ask for it.

The catalog index is built from **catalog images** (uploaded photos + official
images) — never from users' own photos.

## Web fallback

If nothing in the catalog matches, and the admin has enabled it, you'll see a
**"Chercher sur le web"** button. This is **opt-in**: tapping it sends your
photo to Google Cloud Vision (Web Detection), which returns identification
leads — a best-guess label, recognised terms, visually-similar images, and
pages hosting the same image. Use them to identify the piece, then add it by
hand (the best guess pre-fills the name).

!!! warning "This sends the photo off your device"
    The web fallback is the one path where your actual photo is uploaded (to
    Google). The button says so, and nothing is sent until you tap it. It's off
    unless an admin both enables it and configures an API key.

## Admin

Everything lives under **Admin → Réglages → Recherche par photo**:

- **Enable photo search** — surfaces the feature for everyone and allows
  queries. Off by default.
- **Index status & re-index** — shows how many catalog images are embedded vs.
  pending, and whether an embed-capable worker is online. **Réindexer** queues
  every catalog image still missing an embedding. New figures and photos are
  **queued automatically** as they're added, so a manual re-index is only needed
  for a first build or after a model change.
- **Web fallback (Google Vision)** — a separate toggle plus the API key field
  (write-only; the stored key is never shown back). Both must be set for the
  fallback to appear.

### Who builds the index

A worker drains the embedding queue, advertising the `embed` **capability** —
the server only lets you build the index while one is online. The embedding runs
on **CPU** (DINOv2-small is light), so it never competes with gsplat training for
the GPU. Two ways to provide it:

- **Your gsplat worker already does it.** The [scan worker](photos.md) runs the
  embed loop as a concurrent, CPU-only task alongside training — so if you run
  it, photo search just works once you enable the feature. Nothing extra to
  deploy. (Rebuild the worker image to pick this up.)
- **A standalone, for a GPU-less host.** If you don't run a gsplat worker — or
  want indexing to live elsewhere — `infrastructure/embed-worker/` is a tiny
  CPU-only image that does only this:

  ```sh
  docker build -t figurecollector-embed-worker infrastructure/embed-worker
  docker run --rm \
    -e DATABASE_URL="postgres://…@db:5432/figurecollector" \
    -e SERVER_URL="http://server:3000" \
    figurecollector-embed-worker
  ```

Both run the **same model and preprocessing as the browser** (shared
`embed_index.py`), so query and index vectors live in one space.

!!! tip "No GPU required"
    Embedding is light — DINOv2-small runs fine on CPU. Whether folded into the
    gsplat worker or run standalone, it only needs to reach the database and the
    API.
