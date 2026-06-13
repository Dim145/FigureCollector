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

/// DINOv2-small feature dimension.
pub const EMBED_DIM: usize = 384;

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
}

/// Best-effort: reset an already-queued image back to `pending` so the worker
/// recomputes it. For an in-place photo replace, the `image_ref` (the photo id)
/// is unchanged but the bytes swapped, so a plain enqueue would no-op on the
/// existing row — this re-arms it instead. Gated + non-fatal.
pub async fn requeue_image_if_enabled(pool: &PgPool, image_ref: &str) {
    if !matches!(settings::visual_search_enabled(pool).await, Ok(true)) {
        return;
    }
    let res = sqlx::query(
        "UPDATE figure_embedding_queue
            SET state = 'pending', error_message = NULL, attempts = 0, claimed_at = NULL
          WHERE image_ref = $1 AND model_version = $2",
    )
    .bind(image_ref)
    .bind(MODEL_VERSION)
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
