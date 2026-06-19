//! Visual search — per-image catalog embeddings (DINOv2-small, 384-d) + cosine
//! ANN over pgvector.
//!
//! The QUERY embedding is produced in the browser (transformers.js) and only
//! the vector reaches us; this module owns the catalog index, the
//! nearest-neighbour search, and the embed work-queue the worker drains.
//!
//! The corpus is CATALOG images only (`figure_photos` + `official_image_url`),
//! never user photos. A figure matches if ANY of its images is a near
//! neighbour (max-similarity), so multi-view figures rank on their best angle.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::settings;
use crate::error::{AppError, AppResult};

/// Model + version. The client (transformers.js), the worker, and the server
/// MUST agree on this exact string so every vector lives in one space — bump
/// it (and re-index) on any model or preprocessing change. It's surfaced to
/// the client through the status endpoint so the browser loads the matching
/// model.
pub const MODEL_VERSION: &str = "dinov2-small/1";

/// DINOv2-small feature dimension. Shared by the text model below (both 384-d),
/// so text embeddings reuse the same `figure_embeddings` table + HNSW index.
pub const EMBED_DIM: usize = 384;

/// Semantic text model — multilingual-e5-small, also 384-d. Its embeddings live
/// in `figure_embeddings` with this `model_version` and `source = "text"`
/// (`image_ref = "text:<figure_id>"`), so `search()`/`index_stats()`/
/// `upsert_embedding()` work unchanged; only the model_version differs.
pub const TEXT_MODEL_VERSION: &str = "e5-small/1";

/// Multimodal model — multilingual SigLIP2-base (768-d, text+image shared
/// space). Catalog IMAGES are embedded with its vision tower (worker) and the
/// query TEXT with its text tower (browser), so a description retrieves figures
/// by look. 768-d ≠ the 384-d models, so these vectors live in their OWN table
/// `figure_clip_embeddings` (the work-queue is shared, keyed by model_version).
pub const CLIP_MODEL_VERSION: &str = "siglip2-base/1";

/// SigLIP2-base projection dimension.
pub const CLIP_EMBED_DIM: usize = 768;

/// Appearance tagging — WD-Tagger v3 (Danbooru tags). NOT an embedding model:
/// the worker tags each catalogue image and writes the tags to `figures.
/// visual_tags`, which `compose_figure_text` appends to the e5 passage so the
/// "Sens" (text) search finds figures by look. Rides the shared embed queue with
/// this `model_version` + `source = 'tags'`.
pub const TAGGER_MODEL_VERSION: &str = "wd-tagger-v3/1";

/// A catalog figure that matched the query photo, with its best (smallest)
/// cosine distance across that figure's images. 0 = identical, 2 = opposite;
/// in practice a strong match sits well under ~0.3.
#[derive(Debug, Clone, Serialize)]
pub struct Candidate {
    pub figure_id: Uuid,
    pub distance: f32,
}

/// Upsert one catalog image's embedding — idempotent on (image_ref, model).
pub async fn upsert_embedding(
    pool: &PgPool,
    figure_id: Uuid,
    source: &str,
    image_ref: &str,
    model_version: &str,
    embedding: Vec<f32>,
) -> AppResult<()> {
    if embedding.len() != EMBED_DIM {
        return Err(AppError::BadRequest("embedding has the wrong dimension"));
    }
    sqlx::query(
        "INSERT INTO figure_embeddings (figure_id, source, image_ref, model_version, embedding)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (image_ref, model_version) DO UPDATE SET
            figure_id  = EXCLUDED.figure_id,
            source     = EXCLUDED.source,
            embedding  = EXCLUDED.embedding,
            created_at = now()",
    )
    .bind(figure_id)
    .bind(source)
    .bind(image_ref)
    .bind(model_version)
    .bind(pgvector::Vector::from(embedding))
    .execute(pool)
    .await?;
    Ok(())
}

/// Nearest catalog figures to a query embedding. Rides the HNSW index for the
/// top per-image neighbours, then dedups to one row per figure (keeping its
/// closest image), returning at most `k` distinct figures.
pub async fn search(
    pool: &PgPool,
    query: Vec<f32>,
    model_version: &str,
    k: i64,
) -> AppResult<Vec<Candidate>> {
    if query.len() != EMBED_DIM {
        return Err(AppError::BadRequest("query embedding has the wrong dimension"));
    }
    // Over-fetch images (k × fanout) so dedup-by-figure can still yield k
    // distinct figures when one figure owns several near neighbours.
    let fanout = (k * 5).clamp(20, 200);
    let qv = pgvector::Vector::from(query);
    let rows: Vec<(Uuid, f64)> = sqlx::query_as(
        "SELECT figure_id, (embedding <=> $1) AS distance
         FROM figure_embeddings
         WHERE model_version = $2
         ORDER BY embedding <=> $1
         LIMIT $3",
    )
    .bind(qv)
    .bind(model_version)
    .bind(fanout)
    .fetch_all(pool)
    .await?;

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (figure_id, distance) in rows {
        if seen.insert(figure_id) {
            out.push(Candidate { figure_id, distance: distance as f32 });
            if out.len() as i64 >= k {
                break;
            }
        }
    }
    Ok(out)
}

/// Nearest catalog figures to a SigLIP text-query embedding — the "recherche par
/// apparence" mode. Same per-image ANN + dedup-by-figure as `search()`, but over
/// the 768-d `figure_clip_embeddings` table (a description retrieves figures by
/// look). The query vector comes from the browser's SigLIP text tower.
pub async fn clip_search(pool: &PgPool, query: Vec<f32>, k: i64) -> AppResult<Vec<Candidate>> {
    if query.len() != CLIP_EMBED_DIM {
        return Err(AppError::BadRequest("query embedding has the wrong dimension"));
    }
    let fanout = (k * 5).clamp(20, 200);
    let qv = pgvector::Vector::from(query);
    let rows: Vec<(Uuid, f64)> = sqlx::query_as(
        "SELECT figure_id, (embedding <=> $1) AS distance
         FROM figure_clip_embeddings
         WHERE model_version = $2
         ORDER BY embedding <=> $1
         LIMIT $3",
    )
    .bind(qv)
    .bind(CLIP_MODEL_VERSION)
    .bind(fanout)
    .fetch_all(pool)
    .await?;

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (figure_id, distance) in rows {
        if seen.insert(figure_id) {
            out.push(Candidate { figure_id, distance: distance as f32 });
            if out.len() as i64 >= k {
                break;
            }
        }
    }
    Ok(out)
}

/// Enqueue every catalog image still lacking a SigLIP embedding (photos +
/// official), checking `figure_clip_embeddings`. Mirrors `enqueue_missing` for
/// the clip model/table; the worker drains them with its vision tower.
pub async fn enqueue_missing_clip(pool: &PgPool) -> AppResult<u64> {
    let photos = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT fp.figure_id, 'photo', fp.id::text, $1
         FROM figure_photos fp
         WHERE NOT EXISTS (
             SELECT 1 FROM figure_clip_embeddings e
             WHERE e.image_ref = fp.id::text AND e.model_version = $1
         )
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(CLIP_MODEL_VERSION)
    .execute(pool)
    .await?;

    let official = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT f.id, 'official', f.official_image_url, $1
         FROM figures f
         WHERE f.official_image_url IS NOT NULL
           AND f.official_image_url <> ''
           AND NOT EXISTS (
             SELECT 1 FROM figure_clip_embeddings e
             WHERE e.image_ref = f.official_image_url AND e.model_version = $1
           )
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(CLIP_MODEL_VERSION)
    .execute(pool)
    .await?;

    Ok(photos.rows_affected() + official.rows_affected())
}

/// Index stats for the clip model: embedded count from `figure_clip_embeddings`,
/// pending from the shared queue.
pub async fn index_stats_clip(pool: &PgPool) -> AppResult<IndexStats> {
    let embedded: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM figure_clip_embeddings WHERE model_version = $1")
            .bind(CLIP_MODEL_VERSION)
            .fetch_one(pool)
            .await?;
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM figure_embedding_queue
         WHERE model_version = $1 AND state IN ('pending', 'processing')",
    )
    .bind(CLIP_MODEL_VERSION)
    .fetch_one(pool)
    .await?;
    Ok(IndexStats { embedded, pending })
}

/// Enqueue one tagging job per figure that has an image but no `visual_tags`
/// yet (one row per figure, `source = 'tags'`, `image_ref = 'tags:<id>'`). The
/// worker tags the figure's image, writes the tags, then re-enqueues its e5
/// text so the tags reach the semantic index.
pub async fn enqueue_missing_tags(pool: &PgPool) -> AppResult<u64> {
    let res = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT f.id, 'tags', 'tags:' || f.id::text, $1
         FROM figures f
         WHERE f.visual_tags IS NULL
           AND (
             (f.official_image_url IS NOT NULL AND f.official_image_url <> '')
             OR EXISTS (SELECT 1 FROM figure_photos fp WHERE fp.figure_id = f.id)
           )
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(TAGGER_MODEL_VERSION)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// How many catalogue figures have appearance tags — surfaced in the status so
/// the admin sees tagging progress.
pub async fn tagged_count(pool: &PgPool) -> AppResult<i64> {
    Ok(sqlx::query_scalar("SELECT COUNT(*) FROM figures WHERE visual_tags IS NOT NULL")
        .fetch_one(pool)
        .await?)
}

/// Nearest catalog figures to a *source figure* — the "figurines proches" rail
/// on a figure's page. Seeds the search from the source figure's OWN image
/// embeddings (it may have several: photos + the official image), keeps each
/// other figure's best (smallest) cross-image distance, and returns the top `k`
/// distinct neighbours. The source figure itself is excluded.
///
/// One query: for every seed embedding the LATERAL rides the HNSW index
/// (`ORDER BY … <=> seed LIMIT fanout`), then `MIN()` per candidate figure
/// collapses multi-view matches to their closest angle — the same
/// max-similarity rule `search()` uses.
pub async fn similar_figures(
    pool: &PgPool,
    figure_id: Uuid,
    model_version: &str,
    k: i64,
    max_distance: f64,
) -> AppResult<Vec<Candidate>> {
    // Over-fetch per seed (as in search()) so dedup-by-figure still yields k
    // distinct neighbours when one figure owns several near images.
    let fanout = (k * 5).clamp(20, 200);
    let rows: Vec<(Uuid, f64)> = sqlx::query_as(
        "SELECT n.figure_id, MIN(n.distance) AS distance
         FROM figure_embeddings src
         CROSS JOIN LATERAL (
             SELECT e.figure_id, (e.embedding <=> src.embedding) AS distance
             FROM figure_embeddings e
             WHERE e.model_version = $2 AND e.figure_id <> $1
             ORDER BY e.embedding <=> src.embedding
             LIMIT $3
         ) n
         WHERE src.figure_id = $1 AND src.model_version = $2
         GROUP BY n.figure_id
         HAVING MIN(n.distance) <= $5
         ORDER BY distance
         LIMIT $4",
    )
    .bind(figure_id)
    .bind(model_version)
    .bind(fanout)
    .bind(k)
    .bind(max_distance)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(figure_id, distance)| Candidate { figure_id, distance: distance as f32 })
        .collect())
}

/// Personalised recommendations — the "reco par goût" rail. Seeds the ANN from
/// the embeddings of every figure the user OWNS (non-archived) and returns the
/// nearest catalogue figures they neither own nor wishlist, deduped to one row
/// per figure (its closest owned seed wins). Empty when the user owns nothing
/// that's on the index.
pub async fn recommendations(
    pool: &PgPool,
    user_id: Uuid,
    model_version: &str,
    k: i64,
    max_distance: f64,
) -> AppResult<Vec<Candidate>> {
    // Over-fetch per seed so the owned/wishlisted exclusion still leaves k
    // distinct recommendations (as in search()/similar_figures()).
    let fanout = (k * 5).clamp(20, 200);
    let rows: Vec<(Uuid, f64)> = sqlx::query_as(
        "SELECT n.figure_id, MIN(n.distance) AS distance
         FROM figure_embeddings src
         JOIN owned_items oi
           ON oi.figure_id = src.figure_id AND oi.user_id = $1 AND oi.archived_at IS NULL
         CROSS JOIN LATERAL (
             SELECT e.figure_id, (e.embedding <=> src.embedding) AS distance
             FROM figure_embeddings e
             WHERE e.model_version = $2
               AND NOT EXISTS (
                   SELECT 1 FROM owned_items o
                   WHERE o.user_id = $1 AND o.figure_id = e.figure_id AND o.archived_at IS NULL
               )
               AND NOT EXISTS (
                   SELECT 1 FROM wishlist_items w
                   WHERE w.user_id = $1 AND w.figure_id = e.figure_id
               )
             ORDER BY e.embedding <=> src.embedding
             LIMIT $3
         ) n
         WHERE src.model_version = $2
         GROUP BY n.figure_id
         HAVING MIN(n.distance) <= $5
         ORDER BY distance
         LIMIT $4",
    )
    .bind(user_id)
    .bind(model_version)
    .bind(fanout)
    .bind(k)
    .bind(max_distance)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(figure_id, distance)| Candidate { figure_id, distance: distance as f32 })
        .collect())
}

/// A catalogue figure pair that looks visually near-identical — a likely
/// duplicate listing or re-release. `distance` is the closest cross-figure
/// cosine distance (0 = identical).
#[derive(Debug, Clone, Serialize)]
pub struct DuplicatePair {
    pub figure_id_a: Uuid,
    pub figure_id_b: Uuid,
    pub distance: f32,
}

/// Catalogue duplicate sweep (admin): figure pairs whose closest cross-figure
/// distance sits under `max_distance`. Each embedding's single nearest
/// *other-figure* neighbour rides the HNSW index (the LATERAL); pairs are
/// normalised to (lo, hi), deduped to their closest distance, and filtered by
/// the threshold. O(#embeddings) index lookups — not an O(n²) all-pairs scan.
pub async fn find_duplicates(
    pool: &PgPool,
    model_version: &str,
    max_distance: f64,
    limit: i64,
) -> AppResult<Vec<DuplicatePair>> {
    let rows: Vec<(Uuid, Uuid, f64)> = sqlx::query_as(
        "SELECT lo AS figure_id_a, hi AS figure_id_b, MIN(dist) AS distance
         FROM (
             SELECT LEAST(src.figure_id, n.figure_id)    AS lo,
                    GREATEST(src.figure_id, n.figure_id) AS hi,
                    n.dist
             FROM figure_embeddings src
             CROSS JOIN LATERAL (
                 SELECT e.figure_id, (e.embedding <=> src.embedding) AS dist
                 FROM figure_embeddings e
                 WHERE e.model_version = $1 AND e.figure_id <> src.figure_id
                 ORDER BY e.embedding <=> src.embedding
                 LIMIT 1
             ) n
             WHERE src.model_version = $1
         ) p
         GROUP BY lo, hi
         HAVING MIN(dist) < $2
         ORDER BY distance
         LIMIT $3",
    )
    .bind(model_version)
    .bind(max_distance)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(figure_id_a, figure_id_b, distance)| DuplicatePair {
            figure_id_a,
            figure_id_b,
            distance: distance as f32,
        })
        .collect())
}

/// Index readiness for the current model — how many catalog images are
/// embedded vs still queued.
#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub embedded: i64,
    pub pending: i64,
}

pub async fn index_stats(pool: &PgPool, model_version: &str) -> AppResult<IndexStats> {
    let embedded: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM figure_embeddings WHERE model_version = $1")
            .bind(model_version)
            .fetch_one(pool)
            .await?;
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM figure_embedding_queue
         WHERE model_version = $1 AND state IN ('pending', 'processing')",
    )
    .bind(model_version)
    .fetch_one(pool)
    .await?;
    Ok(IndexStats { embedded, pending })
}

/// Re-arm every failed queue row (admin "retry failures" on the Tasks view) so
/// the worker takes another pass. Returns how many were reset.
pub async fn retry_failed(pool: &PgPool, model_version: &str) -> AppResult<u64> {
    let res = sqlx::query(
        "UPDATE figure_embedding_queue
            SET state = 'pending', error_message = NULL, attempts = 0, claimed_at = NULL
          WHERE state = 'failed' AND model_version = $1",
    )
    .bind(model_version)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Wipe ONE index from scratch: delete its stored vectors/tags AND its queue
/// rows so the caller's `enqueue_missing_*` re-adds everything. `kind` is one of
/// "image" | "text" | "look" | "tags". Wrapped in a transaction so a half-wipe
/// can't leave the index inconsistent.
///
/// Note the e5 `figure_embeddings` table holds BOTH the descriptive text vectors
/// (`source = 'text'`, `image_ref = 'text:…'`) and the appearance-tag vectors
/// (`source = 'tags'`, `image_ref = 'tagvec:…'`), so "text" and "tags" each scope
/// their deletes by source/prefix and never clobber the other.
pub async fn wipe_index(pool: &PgPool, kind: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    match kind {
        "image" => {
            sqlx::query("DELETE FROM figure_embeddings WHERE model_version = $1")
                .bind(MODEL_VERSION)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM figure_embedding_queue WHERE model_version = $1")
                .bind(MODEL_VERSION)
                .execute(&mut *tx)
                .await?;
        }
        "text" => {
            sqlx::query(
                "DELETE FROM figure_embeddings WHERE model_version = $1 AND source = 'text'",
            )
            .bind(TEXT_MODEL_VERSION)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "DELETE FROM figure_embedding_queue
                 WHERE model_version = $1 AND image_ref LIKE 'text:%'",
            )
            .bind(TEXT_MODEL_VERSION)
            .execute(&mut *tx)
            .await?;
        }
        "look" => {
            sqlx::query("DELETE FROM figure_clip_embeddings WHERE model_version = $1")
                .bind(CLIP_MODEL_VERSION)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM figure_embedding_queue WHERE model_version = $1")
                .bind(CLIP_MODEL_VERSION)
                .execute(&mut *tx)
                .await?;
        }
        "tags" => {
            // The tags themselves, the tag-derived e5 vectors, the tagging jobs,
            // and any pending tagvec re-embed jobs — all reset so a fresh tagging
            // pass regenerates everything.
            sqlx::query("UPDATE figures SET visual_tags = NULL WHERE visual_tags IS NOT NULL")
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "DELETE FROM figure_embeddings WHERE model_version = $1 AND source = 'tags'",
            )
            .bind(TEXT_MODEL_VERSION)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "DELETE FROM figure_embedding_queue
                 WHERE model_version = $1 AND image_ref LIKE 'tagvec:%'",
            )
            .bind(TEXT_MODEL_VERSION)
            .execute(&mut *tx)
            .await?;
            sqlx::query("DELETE FROM figure_embedding_queue WHERE model_version = $1")
                .bind(TAGGER_MODEL_VERSION)
                .execute(&mut *tx)
                .await?;
        }
        _ => return Err(AppError::BadRequest("unknown index kind")),
    }
    tx.commit().await?;
    Ok(())
}

/// One index's live size + queue breakdown for the admin Tasks view, so the
/// panel can show all four (image / text / look / tags) instead of just image.
#[derive(Debug, Clone, Serialize)]
pub struct IndexQueue {
    pub index: &'static str,
    pub model_version: &'static str,
    /// Items currently in this index's own store (embeddings, or tagged figures).
    pub indexed: i64,
    pub pending: i64,
    pub processing: i64,
    pub done: i64,
    pub failed: i64,
    pub last_activity: Option<DateTime<Utc>>,
}

/// Per-state queue counts for `model_version`, optionally restricted to rows
/// whose `image_ref` matches `ref_prefix` (used to split the shared e5 queue into
/// its text: and tagvec: halves). `indexed` is computed by the caller because
/// each index counts its size from a different table.
async fn index_queue_row(
    pool: &PgPool,
    index: &'static str,
    model_version: &'static str,
    ref_prefix: Option<&str>,
    indexed: i64,
) -> AppResult<IndexQueue> {
    let row: (i64, i64, i64, i64, Option<DateTime<Utc>>) = sqlx::query_as(
        "SELECT
            COUNT(*) FILTER (WHERE state = 'pending'),
            COUNT(*) FILTER (WHERE state = 'processing'),
            COUNT(*) FILTER (WHERE state = 'done'),
            COUNT(*) FILTER (WHERE state = 'failed'),
            MAX(COALESCE(claimed_at, enqueued_at))
         FROM figure_embedding_queue
         WHERE model_version = $1
           AND ($2::text IS NULL OR image_ref LIKE $2)",
    )
    .bind(model_version)
    .bind(ref_prefix)
    .fetch_one(pool)
    .await?;
    Ok(IndexQueue {
        index,
        model_version,
        indexed,
        pending: row.0,
        processing: row.1,
        done: row.2,
        failed: row.3,
        last_activity: row.4,
    })
}

/// All four indexes' size + queue snapshot for the admin Tasks view.
pub async fn all_index_queues(pool: &PgPool) -> AppResult<Vec<IndexQueue>> {
    let img: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM figure_embeddings WHERE model_version = $1")
            .bind(MODEL_VERSION)
            .fetch_one(pool)
            .await?;
    let txt: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM figure_embeddings WHERE model_version = $1 AND source = 'text'",
    )
    .bind(TEXT_MODEL_VERSION)
    .fetch_one(pool)
    .await?;
    let look: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM figure_clip_embeddings WHERE model_version = $1")
            .bind(CLIP_MODEL_VERSION)
            .fetch_one(pool)
            .await?;
    let tags: i64 = tagged_count(pool).await?;
    Ok(vec![
        index_queue_row(pool, "image", MODEL_VERSION, None, img).await?,
        index_queue_row(pool, "text", TEXT_MODEL_VERSION, Some("text:%"), txt).await?,
        index_queue_row(pool, "look", CLIP_MODEL_VERSION, None, look).await?,
        index_queue_row(pool, "tags", TAGGER_MODEL_VERSION, None, tags).await?,
    ])
}

// --- Admin reindex as tracked history jobs -----------------------------------
// Each admin-triggered reindex is recorded as a `server_job_runs` row so it
// appears in the Tasks history. The embedding work runs in the external worker,
// so the row stays 'processing' until `reconcile_reindex_jobs` sees that index's
// queue drain, then flips it to 'ready' with the final indexed/failed counts.
pub const JOB_REINDEX_IMAGE: &str = "reindex_image";
pub const JOB_REINDEX_TEXT: &str = "reindex_text";
pub const JOB_REINDEX_LOOK: &str = "reindex_look";
pub const JOB_REINDEX_TAGS: &str = "reindex_tags";
pub const JOB_REINDEX_ALL: &str = "reindex_all";

/// The server_job name for a single-index reindex kind.
pub fn reindex_job_name(kind: &str) -> &'static str {
    match kind {
        "text" => JOB_REINDEX_TEXT,
        "look" => JOB_REINDEX_LOOK,
        "tags" => JOB_REINDEX_TAGS,
        _ => JOB_REINDEX_IMAGE,
    }
}

/// Run one index's reindex: wipe it first when `force`, (re)enqueue what's
/// missing, and on a non-force run also re-arm its failed rows so a plain
/// re-trigger resumes stuck work. Returns how many queue rows were added.
pub async fn reindex(pool: &PgPool, kind: &str, force: bool) -> AppResult<u64> {
    if force {
        wipe_index(pool, kind).await?;
    }
    let queued = match kind {
        "image" => enqueue_missing(pool, MODEL_VERSION).await?,
        "text" => enqueue_missing_text(pool).await?,
        "look" => enqueue_missing_clip(pool).await?,
        "tags" => enqueue_missing_tags(pool).await?,
        _ => return Err(AppError::BadRequest("unknown index kind")),
    };
    if !force {
        let mv = match kind {
            "text" => TEXT_MODEL_VERSION,
            "look" => CLIP_MODEL_VERSION,
            "tags" => TAGGER_MODEL_VERSION,
            _ => MODEL_VERSION,
        };
        retry_failed(pool, mv).await?;
    }
    Ok(queued)
}

/// Force a from-scratch rebuild of ALL four indexes (wipe + re-enqueue each).
pub async fn reindex_all(pool: &PgPool) -> AppResult<u64> {
    for kind in ["image", "text", "look", "tags"] {
        wipe_index(pool, kind).await?;
    }
    Ok(enqueue_missing(pool, MODEL_VERSION).await?
        + enqueue_missing_text(pool).await?
        + enqueue_missing_clip(pool).await?
        + enqueue_missing_tags(pool).await?)
}

/// Close admin reindex jobs once their index's queue has drained (pending +
/// processing = 0), recording the final indexed/failed counts. Runs on a short
/// server interval — the embedding itself happens in the external worker, so the
/// server can't finish these synchronously at trigger time.
pub async fn reconcile_reindex_jobs(pool: &PgPool) -> AppResult<()> {
    let runs: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, job_name FROM server_job_runs
          WHERE state = 'processing' AND job_name LIKE 'reindex\\_%' ESCAPE '\\'",
    )
    .fetch_all(pool)
    .await?;
    if runs.is_empty() {
        return Ok(());
    }
    let queues = all_index_queues(pool).await?;
    let find = |idx: &str| queues.iter().find(|q| q.index == idx);
    for (id, name) in runs {
        let kinds: &[&str] = match name.as_str() {
            JOB_REINDEX_IMAGE => &["image"],
            JOB_REINDEX_TEXT => &["text"],
            JOB_REINDEX_LOOK => &["look"],
            JOB_REINDEX_TAGS => &["tags"],
            JOB_REINDEX_ALL => &["image", "text", "look", "tags"],
            _ => continue,
        };
        let stats: Vec<&IndexQueue> = kinds.iter().filter_map(|k| find(k)).collect();
        if stats.len() != kinds.len() {
            continue; // stats momentarily unavailable — try again next tick
        }
        if stats.iter().all(|s| s.pending + s.processing == 0) {
            let result = serde_json::json!({
                "indexed": stats.iter().map(|s| s.indexed).sum::<i64>(),
                "failed": stats.iter().map(|s| s.failed).sum::<i64>(),
            });
            crate::domain::server_job::finish_ok(pool, id, &result).await?;
        }
    }
    Ok(())
}

/// Enqueue every catalog image still lacking an embedding for `model_version`:
/// each figure's uploaded catalog photos plus its `official_image_url`.
/// Idempotent (skips images already embedded or already queued). Returns how
/// many rows were added; the worker drains them later.
pub async fn enqueue_missing(pool: &PgPool, model_version: &str) -> AppResult<u64> {
    // Uploaded catalog photos — image_ref = the photo UUID as text.
    let photos = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT fp.figure_id, 'photo', fp.id::text, $1
         FROM figure_photos fp
         WHERE NOT EXISTS (
             SELECT 1 FROM figure_embeddings e
             WHERE e.image_ref = fp.id::text AND e.model_version = $1
         )
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(model_version)
    .execute(pool)
    .await?;

    // The external official image, when present — image_ref = the URL.
    let official = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT f.id, 'official', f.official_image_url, $1
         FROM figures f
         WHERE f.official_image_url IS NOT NULL
           AND f.official_image_url <> ''
           AND NOT EXISTS (
             SELECT 1 FROM figure_embeddings e
             WHERE e.image_ref = f.official_image_url AND e.model_version = $1
           )
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(model_version)
    .execute(pool)
    .await?;

    Ok(photos.rows_affected() + official.rows_affected())
}

/// Enqueue every catalogue figure once for SEMANTIC TEXT indexing — one queue
/// row per figure (`source = 'text'`, `image_ref = 'text:<id>'`). Idempotent:
/// skips figures already embedded or queued for the text model. The worker
/// fetches each figure's text and embeds it with multilingual-e5-small.
pub async fn enqueue_missing_text(pool: &PgPool) -> AppResult<u64> {
    let res = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT f.id, 'text', 'text:' || f.id::text, $1
         FROM figures f
         WHERE NOT EXISTS (
             SELECT 1 FROM figure_embeddings e
             WHERE e.image_ref = 'text:' || f.id::text AND e.model_version = $1
         )
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(TEXT_MODEL_VERSION)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Enqueue just one figure's images (called when a figure or its photos
/// change, so the index stays current incrementally).
pub async fn enqueue_figure(pool: &PgPool, figure_id: Uuid, model_version: &str) -> AppResult<u64> {
    let photos = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT fp.figure_id, 'photo', fp.id::text, $2
         FROM figure_photos fp
         WHERE fp.figure_id = $1
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(figure_id)
    .bind(model_version)
    .execute(pool)
    .await?;

    let official = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT f.id, 'official', f.official_image_url, $2
         FROM figures f
         WHERE f.id = $1
           AND f.official_image_url IS NOT NULL
           AND f.official_image_url <> ''
         ON CONFLICT (image_ref, model_version) DO NOTHING",
    )
    .bind(figure_id)
    .bind(model_version)
    .execute(pool)
    .await?;

    Ok(photos.rows_affected() + official.rows_affected())
}

/// Best-effort incremental enqueue, called after a figure or photo mutation so
/// the index stays current without an admin reindex. Gated on the feature flag
/// (no point queueing work when photo search is off) and never fails the
/// caller — a queue hiccup must not break figure/photo creation.
pub async fn enqueue_figure_if_enabled(pool: &PgPool, figure_id: Uuid) {
    match settings::visual_search_enabled(pool).await {
        Ok(true) => {
            if let Err(e) = enqueue_figure(pool, figure_id, MODEL_VERSION).await {
                tracing::warn!(error = ?e, %figure_id, "visual-search auto-enqueue failed");
            }
        }
        Ok(false) => {}
        Err(e) => tracing::warn!(error = ?e, "visual-search enqueue gate check failed"),
    }
    // SigLIP "search by look" rides the same per-image queue (different model);
    // keep its index current too when it's enabled.
    if matches!(settings::clip_search_enabled(pool).await, Ok(true)) {
        if let Err(e) = enqueue_figure(pool, figure_id, CLIP_MODEL_VERSION).await {
            tracing::warn!(error = ?e, %figure_id, "clip-search auto-enqueue failed");
        }
    }
    // Appearance tags: auto-tag ONLY figures that have no tags yet, so we never
    // overwrite tags an admin/owner set (or the tagger already produced) by hand.
    // A manual edit refreshes the index via `requeue_tagvec_if_enabled` instead.
    if matches!(settings::appearance_tags_enabled(pool).await, Ok(true)) {
        let res = sqlx::query(
            "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
             SELECT $1, 'tags', 'tags:' || $1::text, $2
             WHERE EXISTS (SELECT 1 FROM figures WHERE id = $1 AND visual_tags IS NULL)
             ON CONFLICT (image_ref, model_version) DO NOTHING",
        )
        .bind(figure_id)
        .bind(TAGGER_MODEL_VERSION)
        .execute(pool)
        .await;
        if let Err(e) = res {
            tracing::warn!(error = ?e, %figure_id, "appearance-tags auto-enqueue failed");
        }
    }
}

/// Re-arm a figure's tagvec (e5) embedding after its appearance tags were edited
/// by hand, so the "Description" search reflects the change. If the tags were
/// cleared (empty), the text loop drops the vector. Best-effort + feature-gated.
pub async fn requeue_tagvec_if_enabled(pool: &PgPool, figure_id: Uuid) {
    if !matches!(settings::appearance_tags_enabled(pool).await, Ok(true)) {
        return;
    }
    let res = sqlx::query(
        "INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
         SELECT $1, 'tags', 'tagvec:' || $1::text, $2
         WHERE EXISTS (SELECT 1 FROM figures WHERE id = $1 AND visual_tags IS NOT NULL)
         ON CONFLICT (image_ref, model_version) DO UPDATE
           SET state = 'pending', error_message = NULL, attempts = 0, claimed_at = NULL",
    )
    .bind(figure_id)
    .bind(TEXT_MODEL_VERSION)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!(error = ?e, %figure_id, "tagvec re-enqueue after tag edit failed");
    }
}

/// Best-effort: reset an already-queued image back to `pending` so the worker
/// recomputes it. For an in-place photo replace, the `image_ref` (the photo id)
/// is unchanged but the bytes swapped, so a plain enqueue would no-op on the
/// existing row — this re-arms it instead. Gated + non-fatal.
pub async fn requeue_image_if_enabled(pool: &PgPool, image_ref: &str) {
    let vs = matches!(settings::visual_search_enabled(pool).await, Ok(true));
    let clip = matches!(settings::clip_search_enabled(pool).await, Ok(true));
    if !vs && !clip {
        return;
    }
    // Re-arm every image-model row for this ref (DINOv2 + SigLIP); the text
    // model keys off `text:<id>`, so it never matches an image ref here.
    let res = sqlx::query(
        "UPDATE figure_embedding_queue
            SET state = 'pending', error_message = NULL, attempts = 0, claimed_at = NULL
          WHERE image_ref = $1 AND model_version <> $2",
    )
    .bind(image_ref)
    .bind(TEXT_MODEL_VERSION)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!(error = ?e, image_ref, "visual-search re-queue failed");
    }
}

/// Drop an image's index + queue rows when its source is gone (a catalog photo
/// was deleted). `figure_embeddings`/`figure_embedding_queue` cascade on
/// *figure* delete, but a photo delete has no FK to follow, so a stale vector
/// would otherwise keep matching. Unconditional (clean up even when the feature
/// is off) + non-fatal.
pub async fn forget_image(pool: &PgPool, image_ref: &str) {
    for table in ["figure_embeddings", "figure_embedding_queue"] {
        let sql = format!("DELETE FROM {table} WHERE image_ref = $1");
        if let Err(e) = sqlx::query(&sql).bind(image_ref).execute(pool).await {
            tracing::warn!(error = ?e, image_ref, table, "visual-search forget_image failed");
        }
    }
}
