//! Phase 3 — public profiles + library compare.
//!
//! GET  /api/u/{slug}            : public profile (collection summary) if opted-in
//! PATCH /api/me/profile         : toggle `public_profile_enabled`
//! GET  /api/compare/{slug}      : 3-bucket diff between viewer and target

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, patch as patch_method},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use tower_sessions::Session;
use uuid::Uuid;

// --- helpers -----------------------------------------------------------------

#[derive(FromRow)]
struct ProfileBasics {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    locale: String,
    created_at: DateTime<Utc>,
    public_profile_enabled: bool,
}

async fn load_public_user(pool: &PgPool, slug: &str) -> AppResult<ProfileBasics> {
    // Filter on `public_profile_enabled` directly so a hypothetical
    // case-collision (same username with different case) can't shadow the
    // public profile with a private one.
    let row: Option<ProfileBasics> = sqlx::query_as(
        "SELECT id, username, display_name, avatar_url, locale, created_at, public_profile_enabled
         FROM users
         WHERE LOWER(username) = LOWER($1)
           AND public_profile_enabled = TRUE
         LIMIT 1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await?;
    row.ok_or(AppError::NotFound)
}

// --- GET /api/u/{slug} -------------------------------------------------------

#[derive(Serialize)]
struct PublicProfileResponse {
    user: PublicUserCard,
    collection: Vec<PublicCollectionEntry>,
    stats: PublicStats,
}

#[derive(Serialize)]
struct PublicUserCard {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    locale: String,
    member_since: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
struct PublicCollectionEntry {
    owned_id: Uuid,
    figure_id: Uuid,
    figure_name: String,
    figure_slug: String,
    figure_type: String,
    figure_image: Option<String>,
    manufacturer_name: Option<String>,
    scale: Option<String>,
    height_mm: Option<i32>,
    version_name: Option<String>,
    condition: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
struct PublicStats {
    pieces: i64,
    series_count: i64,
    manufacturers_count: i64,
}

async fn get_public_profile(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> AppResult<Json<PublicProfileResponse>> {
    let user = load_public_user(&state.pool, &slug).await?;

    let collection: Vec<PublicCollectionEntry> = sqlx::query_as(
        "SELECT
            o.id AS owned_id, o.figure_id, f.name AS figure_name, f.slug AS figure_slug,
            f.figure_type, f.official_image_url AS figure_image,
            m.name AS manufacturer_name, f.scale, f.height_mm, f.version_name,
            o.condition, o.created_at
         FROM owned_items o
         JOIN figures f         ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.pool)
    .await?;

    let stats: PublicStats = sqlx::query_as(
        "SELECT
            COUNT(*)::bigint AS pieces,
            COUNT(DISTINCT fs.series_id)::bigint AS series_count,
            COUNT(DISTINCT f.manufacturer_id)::bigint AS manufacturers_count
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id
         LEFT JOIN figure_series fs ON fs.figure_id = f.id
         WHERE o.user_id = $1",
    )
    .bind(user.id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(PublicProfileResponse {
        user: PublicUserCard {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            locale: user.locale,
            member_since: user.created_at,
        },
        collection,
        stats,
    }))
}

// --- PATCH /api/me/profile ---------------------------------------------------

#[derive(Deserialize)]
struct ProfilePatch {
    public_profile_enabled: Option<bool>,
    nsfw_visibility: Option<String>,
}

#[derive(Serialize)]
struct ProfileResponse {
    public_profile_enabled: bool,
    nsfw_visibility: String,
}

async fn patch_my_profile(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<ProfilePatch>,
) -> AppResult<Json<ProfileResponse>> {
    let user_id = auth::require_user(&session).await?;

    if let Some(v) = input.nsfw_visibility.as_deref() {
        if !matches!(v, "hide" | "blur" | "show") {
            return Err(crate::error::AppError::BadRequest(
                "nsfw_visibility must be hide, blur or show",
            ));
        }
    }

    let row: (bool, String) = sqlx::query_as(
        "UPDATE users SET
            public_profile_enabled = COALESCE($1, public_profile_enabled),
            nsfw_visibility        = COALESCE($2, nsfw_visibility)
         WHERE id = $3
         RETURNING public_profile_enabled, nsfw_visibility",
    )
    .bind(input.public_profile_enabled)
    .bind(input.nsfw_visibility.as_deref())
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    state.events.publish(user_id, Event::ProfileUpdated);

    Ok(Json(ProfileResponse {
        public_profile_enabled: row.0,
        nsfw_visibility: row.1,
    }))
}

// --- GET /api/compare/{slug} -------------------------------------------------

#[derive(Serialize)]
struct CompareResponse {
    them: PublicUserCard,
    common: Vec<CompareEntry>,
    yours_only: Vec<CompareEntry>,
    theirs_only: Vec<CompareEntry>,
}

#[derive(Serialize, FromRow)]
struct CompareEntry {
    figure_id: Uuid,
    figure_name: String,
    figure_slug: String,
    figure_type: String,
    figure_image: Option<String>,
    manufacturer_name: Option<String>,
}

async fn compare(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<CompareResponse>> {
    let viewer = auth::require_user(&session).await?;
    let them = load_public_user(&state.pool, &slug).await?;
    if them.id == viewer {
        return Err(AppError::BadRequest("cannot compare against yourself"));
    }

    let common = compare_query(&state.pool, viewer, them.id, "intersect").await?;
    let yours_only = compare_query(&state.pool, viewer, them.id, "yours").await?;
    let theirs_only = compare_query(&state.pool, viewer, them.id, "theirs").await?;

    Ok(Json(CompareResponse {
        them: PublicUserCard {
            id: them.id,
            username: them.username,
            display_name: them.display_name,
            avatar_url: them.avatar_url,
            locale: them.locale,
            member_since: them.created_at,
        },
        common,
        yours_only,
        theirs_only,
    }))
}

async fn compare_query(
    pool: &PgPool,
    viewer: Uuid,
    them: Uuid,
    bucket: &str,
) -> AppResult<Vec<CompareEntry>> {
    let condition = match bucket {
        "intersect" => "f.id IN (SELECT figure_id FROM owned_items WHERE user_id = $1) \
                        AND f.id IN (SELECT figure_id FROM owned_items WHERE user_id = $2)",
        "yours"     => "f.id IN (SELECT figure_id FROM owned_items WHERE user_id = $1) \
                        AND f.id NOT IN (SELECT figure_id FROM owned_items WHERE user_id = $2)",
        "theirs"    => "f.id IN (SELECT figure_id FROM owned_items WHERE user_id = $2) \
                        AND f.id NOT IN (SELECT figure_id FROM owned_items WHERE user_id = $1)",
        _ => unreachable!(),
    };
    let sql = format!(
        "SELECT DISTINCT f.id AS figure_id, f.name AS figure_name, f.slug AS figure_slug,
                f.figure_type, f.official_image_url AS figure_image,
                m.name AS manufacturer_name
         FROM figures f
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE {condition}
         ORDER BY f.name"
    );
    Ok(sqlx::query_as::<_, CompareEntry>(&sql)
        .bind(viewer)
        .bind(them)
        .fetch_all(pool)
        .await?)
}

// --- router ------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/u/{slug}", get(get_public_profile))
        .route("/me/profile", patch_method(patch_my_profile))
        .route("/compare/{slug}", get(compare))
}
