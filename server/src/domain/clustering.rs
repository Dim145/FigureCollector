//! Visual-style clustering — the "browse par ambiance" view.
//!
//! One centroid per figure (the mean of its DINOv2 image embeddings), then a
//! small, deterministic k-means over those centroids groups the catalogue into
//! visual "ambiances". Deterministic init (farthest-point / k-center) over a
//! stable figure order means the clusters don't shuffle between page loads.
//! Results are cached in-process and recomputed only when the embedded-figure
//! count changes — no new crates, no OpenSSL (pure `Vec<f32>` maths).

use std::sync::OnceLock;

use sqlx::PgPool;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppResult;

/// Per-figure metadata kept beside its centroid so a cluster can be labelled
/// (dominant type + distinctive appearance tags) and NSFW-filtered without
/// re-querying.
#[derive(Debug, Clone)]
pub struct MemberMeta {
    pub id: Uuid,
    pub figure_type: String,
    pub is_nsfw: bool,
    /// Comma-separated WD-Tagger appearance tags (e.g. "1girl, elf, red hair").
    /// `None`/empty until the figure is tagged; used to name each ambiance.
    pub visual_tags: Option<String>,
}

/// A computed ambiance: its members ordered closest-to-centroid first (so the
/// head is the representative and the order drives the mosaic).
#[derive(Debug, Clone)]
pub struct ComputedCluster {
    pub members: Vec<MemberMeta>,
}

struct Snapshot {
    figure_count: i64,
    clusters: Vec<ComputedCluster>,
}

fn cache() -> &'static RwLock<Option<Snapshot>> {
    static CACHE: OnceLock<RwLock<Option<Snapshot>>> = OnceLock::new();
    CACHE.get_or_init(|| RwLock::new(None))
}

/// Cluster the catalogue into visual ambiances. Cached in-process; recomputed
/// only when the count of embedded figures changes (figures added/removed/
/// embedded). Deterministic, so the cached and recomputed results agree.
pub async fn clusters(pool: &PgPool, model_version: &str) -> AppResult<Vec<ComputedCluster>> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT figure_id) FROM figure_embeddings WHERE model_version = $1",
    )
    .bind(model_version)
    .fetch_one(pool)
    .await?;

    if let Some(snap) = cache().read().await.as_ref() {
        if snap.figure_count == count {
            return Ok(snap.clusters.clone());
        }
    }

    let computed = compute(pool, model_version).await?;
    *cache().write().await = Some(Snapshot {
        figure_count: count,
        clusters: computed.clone(),
    });
    Ok(computed)
}

async fn compute(pool: &PgPool, model_version: &str) -> AppResult<Vec<ComputedCluster>> {
    // One centroid per figure (mean of its image embeddings), stable order so
    // the deterministic init is reproducible.
    let rows: Vec<(Uuid, String, bool, Option<String>, pgvector::Vector)> = sqlx::query_as(
        "SELECT f.id, f.figure_type, f.is_nsfw, f.visual_tags, AVG(e.embedding)
         FROM figure_embeddings e
         JOIN figures f ON f.id = e.figure_id
         WHERE e.model_version = $1
         GROUP BY f.id, f.figure_type, f.is_nsfw, f.visual_tags
         ORDER BY f.id",
    )
    .bind(model_version)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let meta: Vec<MemberMeta> = rows
        .iter()
        .map(|(id, ft, nsfw, tags, _)| MemberMeta {
            id: *id,
            figure_type: ft.clone(),
            is_nsfw: *nsfw,
            visual_tags: tags.clone(),
        })
        .collect();
    let mut points: Vec<Vec<f32>> = rows.iter().map(|(_, _, _, _, v)| v.to_vec()).collect();
    for p in &mut points {
        normalize(p);
    }

    let n = points.len();
    // ~√n ambiances, clamped to a browseable handful, never more than we have.
    let k = ((n as f64).sqrt().round().clamp(3.0, 8.0) as usize)
        .min(n)
        .max(1);

    let assign = kmeans(&points, k, 25);
    let centroids = cluster_centroids(&points, &assign, k);

    // Bucket members per cluster, each ordered closest-to-centroid first.
    let mut buckets: Vec<Vec<(usize, f32)>> = vec![Vec::new(); k];
    for (i, &c) in assign.iter().enumerate() {
        buckets[c].push((i, cosine_dist(&points[i], &centroids[c])));
    }
    let mut out = Vec::new();
    for mut bucket in buckets {
        if bucket.is_empty() {
            continue;
        }
        bucket.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        out.push(ComputedCluster {
            members: bucket.into_iter().map(|(i, _)| meta[i].clone()).collect(),
        });
    }
    Ok(out)
}

/// Spherical k-means with deterministic farthest-point init.
fn kmeans(points: &[Vec<f32>], k: usize, max_iters: usize) -> Vec<usize> {
    let n = points.len();
    // k-center init: first centroid is the first point, each subsequent one is
    // the point farthest (max cosine distance) from the chosen set.
    let mut centroids: Vec<Vec<f32>> = vec![points[0].clone()];
    while centroids.len() < k {
        let (mut best_i, mut best_d) = (0usize, -1.0f32);
        for (i, p) in points.iter().enumerate() {
            let d = centroids
                .iter()
                .map(|c| cosine_dist(p, c))
                .fold(f32::MAX, f32::min);
            if d > best_d {
                best_d = d;
                best_i = i;
            }
        }
        centroids.push(points[best_i].clone());
    }

    let mut assign = vec![0usize; n];
    for _ in 0..max_iters {
        let mut changed = false;
        for (i, p) in points.iter().enumerate() {
            let (mut best, mut best_d) = (0usize, f32::MAX);
            for (c, cen) in centroids.iter().enumerate() {
                let d = cosine_dist(p, cen);
                if d < best_d {
                    best_d = d;
                    best = c;
                }
            }
            if assign[i] != best {
                assign[i] = best;
                changed = true;
            }
        }
        if !changed {
            break;
        }
        centroids = cluster_centroids(points, &assign, k);
    }
    assign
}

fn cluster_centroids(points: &[Vec<f32>], assign: &[usize], k: usize) -> Vec<Vec<f32>> {
    let dim = points[0].len();
    let mut sums = vec![vec![0f32; dim]; k];
    let mut counts = vec![0usize; k];
    for (i, p) in points.iter().enumerate() {
        let c = assign[i];
        counts[c] += 1;
        for (j, x) in p.iter().enumerate() {
            sums[c][j] += x;
        }
    }
    for c in 0..k {
        if counts[c] > 0 {
            for x in &mut sums[c] {
                *x /= counts[c] as f32;
            }
            normalize(&mut sums[c]);
        }
    }
    sums
}

fn normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// Cosine distance for L2-normalised vectors: `1 − dot`. An all-zero centroid
/// (an emptied cluster) yields distance 1 for everything, so it simply attracts
/// no members.
fn cosine_dist(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    1.0 - dot
}
