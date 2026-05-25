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
    /// Pulled via FromRow as a sanity field; the WHERE clause in the
    /// SELECT already filters on it, but we hydrate the bool too in case
    /// future code paths need to branch on it without a second query.
    #[allow(dead_code)]
    public_profile_enabled: bool,
    /// Drives whether NSFW pieces appear in the public collection list /
    /// stats. We pull it here so the rest of the public-profile pipeline
    /// can branch on it without a second query.
    public_profile_show_nsfw: bool,
}

async fn load_public_user(pool: &PgPool, slug: &str) -> AppResult<ProfileBasics> {
    // Filter on `public_profile_enabled` directly so a hypothetical
    // case-collision (same username with different case) can't shadow the
    // public profile with a private one.
    let row: Option<ProfileBasics> = sqlx::query_as(
        "SELECT id, username, display_name, avatar_url, locale, created_at,
                public_profile_enabled, public_profile_show_nsfw
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

    // When the user has opted to keep their public profile NSFW-free, we
    // exclude NSFW figures from BOTH the listed collection and the stats
    // counts so the page reads as a coherent "safe" snapshot. The owner
    // sees the full thing in their own /collection view as always.
    let hide_nsfw = !user.public_profile_show_nsfw;

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
           AND ($2 = FALSE OR f.is_nsfw = FALSE)
         ORDER BY o.created_at DESC",
    )
    .bind(user.id)
    .bind(hide_nsfw)
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
         WHERE o.user_id = $1
           AND ($2 = FALSE OR f.is_nsfw = FALSE)",
    )
    .bind(user.id)
    .bind(hide_nsfw)
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
    /// Only takes effect when public_profile_enabled is on. When false
    /// (the default), NSFW figures are excluded from the public listing
    /// and stats.
    public_profile_show_nsfw: Option<bool>,
    nsfw_visibility: Option<String>,
    /// `Some("")` is treated as "clear the value" (revert to no preference).
    /// `Some("EUR")` etc. enforces the supported-currency whitelist below.
    /// `None` leaves the existing value untouched.
    preferred_currency: Option<String>,
}

#[derive(Serialize)]
struct ProfileResponse {
    public_profile_enabled: bool,
    public_profile_show_nsfw: bool,
    nsfw_visibility: String,
    preferred_currency: Option<String>,
}

/// Currencies the SPA actually surfaces in its dropdowns. Anything else
/// would be selectable in the user's row but invisible in the UI — keep
/// the two sides in sync.
const SUPPORTED_CURRENCIES: &[&str] = &["JPY", "EUR", "USD", "GBP", "CHF", "CAD"];

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
    // Empty-string → explicit clear; anything else must be in the whitelist.
    let preferred_currency = match input.preferred_currency.as_deref() {
        None => None,                 // leave untouched
        Some("") => Some(None),       // clear back to "no preference"
        Some(code) => {
            if !SUPPORTED_CURRENCIES.contains(&code) {
                return Err(crate::error::AppError::BadRequest(
                    "preferred_currency must be one of: JPY, EUR, USD, GBP, CHF, CAD",
                ));
            }
            Some(Some(code.to_string()))
        }
    };
    // Flatten the double-Option for SQL binding: NULL stays NULL (= COALESCE
    // keeps the existing value); Some(None) means "clear" — we send NULL but
    // bypass COALESCE with a CASE expression so the SQL actually clears.
    let (set_currency, currency_value): (bool, Option<String>) = match preferred_currency {
        None => (false, None),
        Some(v) => (true, v),
    };

    let row: (bool, bool, String, Option<String>) = sqlx::query_as(
        "UPDATE users SET
            public_profile_enabled   = COALESCE($1, public_profile_enabled),
            public_profile_show_nsfw = COALESCE($2, public_profile_show_nsfw),
            nsfw_visibility          = COALESCE($3, nsfw_visibility),
            preferred_currency       = CASE WHEN $4 THEN $5 ELSE preferred_currency END
         WHERE id = $6
         RETURNING public_profile_enabled, public_profile_show_nsfw, nsfw_visibility, preferred_currency",
    )
    .bind(input.public_profile_enabled)
    .bind(input.public_profile_show_nsfw)
    .bind(input.nsfw_visibility.as_deref())
    .bind(set_currency)
    .bind(currency_value.as_deref())
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    state.events.publish(user_id, Event::ProfileUpdated);

    Ok(Json(ProfileResponse {
        public_profile_enabled: row.0,
        public_profile_show_nsfw: row.1,
        nsfw_visibility: row.2,
        preferred_currency: row.3,
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

    // Single-pass diff: materialise the two user-id sets once, FULL OUTER
    // JOIN them on figure_id, then label each row as 'common' / 'yours' /
    // 'theirs' via a CASE over (yours.figure_id IS NULL, theirs.figure_id
    // IS NULL). Previously the route fired three separate queries each
    // with TWO sub-queries on `owned_items` — six scans of the parent
    // table per /compare hit. The composite index added in
    // 20260525000001_perf_indexes makes the two CTE scans index-only.
    #[derive(FromRow)]
    struct CompareRow {
        bucket: String,
        figure_id: Uuid,
        figure_name: String,
        figure_slug: String,
        figure_type: String,
        figure_image: Option<String>,
        manufacturer_name: Option<String>,
    }

    let rows: Vec<CompareRow> = sqlx::query_as(
        "WITH
            yours  AS (SELECT DISTINCT figure_id FROM owned_items WHERE user_id = $1),
            theirs AS (SELECT DISTINCT figure_id FROM owned_items WHERE user_id = $2),
            both   AS (
                SELECT COALESCE(y.figure_id, t.figure_id) AS figure_id,
                       CASE
                           WHEN y.figure_id IS NULL THEN 'theirs'
                           WHEN t.figure_id IS NULL THEN 'yours'
                           ELSE 'common'
                       END AS bucket
                FROM yours y FULL OUTER JOIN theirs t ON t.figure_id = y.figure_id
            )
         SELECT b.bucket,
                f.id AS figure_id, f.name AS figure_name, f.slug AS figure_slug,
                f.figure_type, f.official_image_url AS figure_image,
                m.name AS manufacturer_name
         FROM both b
         JOIN figures f ON f.id = b.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         ORDER BY f.name",
    )
    .bind(viewer)
    .bind(them.id)
    .fetch_all(&state.pool)
    .await?;

    let mut common = Vec::new();
    let mut yours_only = Vec::new();
    let mut theirs_only = Vec::new();
    for r in rows {
        let entry = CompareEntry {
            figure_id: r.figure_id,
            figure_name: r.figure_name,
            figure_slug: r.figure_slug,
            figure_type: r.figure_type,
            figure_image: r.figure_image,
            manufacturer_name: r.manufacturer_name,
        };
        match r.bucket.as_str() {
            "common" => common.push(entry),
            "yours" => yours_only.push(entry),
            "theirs" => theirs_only.push(entry),
            _ => {}
        }
    }

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

// --- router ------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/u/{slug}", get(get_public_profile))
        .route("/me/profile", patch_method(patch_my_profile))
        .route("/compare/{slug}", get(compare))
}
