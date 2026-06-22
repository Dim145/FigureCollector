//! Phase 3 — public profiles + library compare.
//!
//! GET  /api/u/{slug}            : public profile (collection summary) if opted-in
//! PATCH /api/me/profile         : toggle `public_profile_enabled`
//! GET  /api/compare/{slug}      : 3-bucket diff between viewer and target

use crate::auth;
use crate::domain::follow::{self, CurrencyTotal};
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, patch as patch_method},
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
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
    /// Opt-in: when true, the collection's per-currency value is included in
    /// the public response. OFF by default.
    public_profile_show_value: bool,
}

async fn load_public_user(pool: &PgPool, slug: &str) -> AppResult<ProfileBasics> {
    // Filter on `public_profile_enabled` directly so a hypothetical
    // case-collision (same username with different case) can't shadow the
    // public profile with a private one.
    let row: Option<ProfileBasics> = sqlx::query_as(
        "SELECT id, username, display_name, avatar_url, locale, created_at,
                public_profile_enabled, public_profile_show_nsfw, public_profile_show_value
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
    social: SocialInfo,
    /// Per-currency effective value (manual value, else MSRP). Empty unless
    /// the owner opted into `public_profile_show_value`.
    value: Vec<CurrencyTotal>,
}

/// Follow relationship + counts for the viewer relative to this profile.
#[derive(Serialize)]
struct SocialInfo {
    followers: i64,
    following: i64,
    /// viewer → this profile.
    is_following: bool,
    /// this profile → viewer (drives the "vous suit" hint).
    follows_viewer: bool,
    /// The viewer is looking at their own profile.
    is_self: bool,
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
    // Marketplace flags — feed the public "À vendre" section. Asking price is a
    // deliberately-published sale price, so it's NOT gated behind show_value
    // (which governs the private collection valuation).
    for_sale: bool,
    for_trade: bool,
    asking_price_amount: Option<Decimal>,
    asking_price_currency: Option<String>,
    sale_note: Option<String>,
    created_at: DateTime<Utc>,
    // Owner's pinned cover so the vitrine / diorama show the real cover, not
    // catalog art — resolved client-side via `resolveOwnedCover` like /collection.
    cover_photo_id: Option<Uuid>,
    cover_scan_id: Option<Uuid>,
    cover_photo_key: Option<String>,
    catalog_cover_photo_id: Option<Uuid>,
}

#[derive(Serialize, FromRow)]
struct PublicStats {
    pieces: i64,
    series_count: i64,
    manufacturers_count: i64,
}

async fn get_public_profile(
    State(state): State<AppState>,
    session: Session,
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
            o.condition,
            o.for_sale, o.for_trade, o.asking_price_amount, o.asking_price_currency, o.sale_note,
            o.created_at,
            o.cover_photo_id, o.cover_scan_id,
            (SELECT ph.storage_key FROM photos ph WHERE ph.id = o.cover_photo_id) AS cover_photo_key,
            (SELECT fp.id FROM figure_photos fp
               WHERE fp.figure_id = o.figure_id
               ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
               LIMIT 1) AS catalog_cover_photo_id
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

    // Viewer-aware social block. Anonymous callers see no relationship; a
    // viewer on their own profile gets `is_self` (the SPA hides the follow
    // button for that case).
    let viewer = auth::optional_user(&session).await?;
    let (followers, following) = follow::counts(&state.pool, user.id).await?;
    let (is_self, is_following, follows_viewer) = match viewer {
        Some(v) if v == user.id => (true, false, false),
        Some(v) => {
            let (a, b) = follow::relationship(&state.pool, v, user.id).await?;
            (false, a, b)
        }
        None => (false, false, false),
    };

    // Opt-in value, per currency, mirroring "La Cote" (manual `value_amount`
    // when set, else catalog MSRP) and the profile's own NSFW preference.
    let value: Vec<CurrencyTotal> = if user.public_profile_show_value {
        sqlx::query_as(
            "SELECT currency, SUM(amount)::numeric AS amount FROM (
                SELECT CASE WHEN o.value_amount IS NOT NULL
                            THEN COALESCE(o.value_currency, o.price_currency, f.msrp_currency)
                            ELSE f.msrp_currency END           AS currency,
                       COALESCE(o.value_amount, f.msrp_amount) AS amount
                FROM owned_items o
                JOIN figures f ON f.id = o.figure_id
                WHERE o.user_id = $1 AND ($2 = FALSE OR f.is_nsfw = FALSE)
             ) s
             WHERE amount IS NOT NULL AND currency IS NOT NULL
             GROUP BY currency
             ORDER BY amount DESC",
        )
        .bind(user.id)
        .bind(hide_nsfw)
        .fetch_all(&state.pool)
        .await?
    } else {
        Vec::new()
    };

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
        social: SocialInfo {
            followers,
            following,
            is_following,
            follows_viewer,
            is_self,
        },
        value,
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
    /// Opt-in: expose the collection's value (La Cote) on the public profile
    /// / discovery card. OFF by default.
    public_profile_show_value: Option<bool>,
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
    public_profile_show_value: bool,
    nsfw_visibility: String,
    preferred_currency: Option<String>,
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
    // Empty-string → explicit clear; anything else must be in the whitelist.
    let preferred_currency = match input.preferred_currency.as_deref() {
        None => None,                 // leave untouched
        Some("") => Some(None),       // clear back to "no preference"
        Some(code) => {
            if !crate::domain::currency::is_supported(code) {
                return Err(crate::error::AppError::BadRequest(
                    "preferred_currency must be a supported currency code",
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

    let row: (bool, bool, bool, String, Option<String>) = sqlx::query_as(
        "UPDATE users SET
            public_profile_enabled    = COALESCE($1, public_profile_enabled),
            public_profile_show_nsfw  = COALESCE($2, public_profile_show_nsfw),
            public_profile_show_value = COALESCE($3, public_profile_show_value),
            nsfw_visibility           = COALESCE($4, nsfw_visibility),
            preferred_currency        = CASE WHEN $5 THEN $6 ELSE preferred_currency END
         WHERE id = $7
         RETURNING public_profile_enabled, public_profile_show_nsfw, public_profile_show_value,
                   nsfw_visibility, preferred_currency",
    )
    .bind(input.public_profile_enabled)
    .bind(input.public_profile_show_nsfw)
    .bind(input.public_profile_show_value)
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
        public_profile_show_value: row.2,
        nsfw_visibility: row.3,
        preferred_currency: row.4,
    }))
}

// --- GET /api/compare/{slug} -------------------------------------------------

#[derive(Serialize)]
struct CompareResponse {
    them: PublicUserCard,
    /// 0–100 taste-match: Sørensen–Dice over shared series (weighted highest),
    /// manufacturers, then exact pieces. Transparent + explained in the UI.
    affinity: u8,
    common: Vec<CompareEntry>,
    yours_only: Vec<CompareEntry>,
    theirs_only: Vec<CompareEntry>,
    /// Series / manufacturers BOTH collect, ranked by combined piece count.
    shared_series: Vec<SharedFacet>,
    shared_manufacturers: Vec<SharedFacet>,
    /// Paired collection value. `theirs` stays empty unless they opted into
    /// publishing their value (same gate as the public profile).
    value: ComparedValue,
}

#[derive(Serialize, FromRow)]
struct CompareEntry {
    figure_id: Uuid,
    figure_name: String,
    figure_slug: String,
    figure_type: String,
    figure_image: Option<String>,
    manufacturer_name: Option<String>,
    /// NSFW flag so the SPA can blur the viewer's OWN NSFW pieces per their
    /// preference (the target's NSFW is already excluded server-side).
    is_nsfw: bool,
    /// Owner's pinned cover (the viewer's for `yours_only`, the target's for
    /// `theirs_only`/`common`) so the SPA resolves the real cover, not catalog
    /// art — same chain as the collection grid (`resolveOwnedCover`).
    cover_photo_id: Option<Uuid>,
    cover_scan_id: Option<Uuid>,
    cover_photo_key: Option<String>,
    catalog_cover_photo_id: Option<Uuid>,
}

/// A series or manufacturer both collectors own, with the combined piece count.
#[derive(Serialize)]
struct SharedFacet {
    name: String,
    count: i64,
}

#[derive(Serialize)]
struct ComparedValue {
    yours: Vec<CurrencyTotal>,
    theirs: Vec<CurrencyTotal>,
}

/// One row of a series/manufacturer FULL OUTER JOIN diff between the two users.
#[derive(FromRow)]
struct FacetRow {
    bucket: String,
    name: String,
    count: i64,
}

/// Per-currency collection value (manual value, else MSRP) for one user,
/// mirroring the public-profile valuation. Drives the compare value KPIs.
async fn collection_value(
    pool: &PgPool,
    user_id: Uuid,
    hide_nsfw: bool,
) -> AppResult<Vec<CurrencyTotal>> {
    Ok(sqlx::query_as(
        "SELECT currency, SUM(amount)::numeric AS amount FROM (
            SELECT CASE WHEN o.value_amount IS NOT NULL
                        THEN COALESCE(o.value_currency, o.price_currency, f.msrp_currency)
                        ELSE f.msrp_currency END           AS currency,
                   COALESCE(o.value_amount, f.msrp_amount) AS amount
            FROM owned_items o JOIN figures f ON f.id = o.figure_id
            WHERE o.user_id = $1 AND ($2 = FALSE OR f.is_nsfw = FALSE)
         ) s
         WHERE amount IS NOT NULL AND currency IS NOT NULL
         GROUP BY currency
         ORDER BY amount DESC",
    )
    .bind(user_id)
    .bind(hide_nsfw)
    .fetch_all(pool)
    .await?)
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
    // NSFW gate applies ONLY to the target's side: the viewer always sees their
    // OWN full collection (hiding their own pieces because the *target* opted out
    // of NSFW was confusing — "I own 3 but it says 0"). The target's NSFW pieces
    // stay hidden, so `theirs_only`/`common` never leak a piece the target keeps
    // private; a viewer's NSFW piece the target also owns simply falls into
    // `yours_only` instead of `common` (no leak).
    let hide_nsfw = !them.public_profile_show_nsfw;

    // Single-pass diff: materialise the two user-id sets (carrying each owner's
    // pinned cover), FULL OUTER JOIN on figure_id, label each row 'common' /
    // 'yours' / 'theirs'. NB: the join CTE is `merged`, NOT `both` — BOTH is a
    // reserved keyword in Postgres (used in `trim(both …)`), so an unquoted
    // `both` CTE is a hard syntax error → the whole endpoint 500'd.
    #[derive(FromRow)]
    struct CompareRow {
        bucket: String,
        figure_id: Uuid,
        figure_name: String,
        figure_slug: String,
        figure_type: String,
        figure_image: Option<String>,
        manufacturer_name: Option<String>,
        is_nsfw: bool,
        cover_photo_id: Option<Uuid>,
        cover_scan_id: Option<Uuid>,
        cover_photo_key: Option<String>,
        catalog_cover_photo_id: Option<Uuid>,
    }

    let rows: Vec<CompareRow> = sqlx::query_as(
        "WITH
            yours AS (
                SELECT DISTINCT ON (figure_id) figure_id, cover_photo_id, cover_scan_id
                FROM owned_items WHERE user_id = $1
                ORDER BY figure_id, created_at DESC
            ),
            theirs AS (
                SELECT DISTINCT ON (o.figure_id) o.figure_id, o.cover_photo_id, o.cover_scan_id
                FROM owned_items o JOIN figures f ON f.id = o.figure_id
                WHERE o.user_id = $2 AND ($3 = FALSE OR f.is_nsfw = FALSE)
                ORDER BY o.figure_id, o.created_at DESC
            ),
            merged AS (
                SELECT COALESCE(y.figure_id, t.figure_id) AS figure_id,
                       CASE
                           WHEN y.figure_id IS NULL THEN 'theirs'
                           WHEN t.figure_id IS NULL THEN 'yours'
                           ELSE 'common'
                       END AS bucket,
                       -- cover belongs to whoever 'owns' the bucket: yours-only →
                       -- you, theirs-only & common → them (the shelf being browsed).
                       CASE WHEN t.figure_id IS NULL THEN y.cover_photo_id ELSE t.cover_photo_id END AS cover_photo_id,
                       CASE WHEN t.figure_id IS NULL THEN y.cover_scan_id  ELSE t.cover_scan_id  END AS cover_scan_id
                FROM yours y FULL OUTER JOIN theirs t ON t.figure_id = y.figure_id
            )
         SELECT b.bucket,
                f.id AS figure_id, f.name AS figure_name, f.slug AS figure_slug,
                f.figure_type, f.official_image_url AS figure_image, f.is_nsfw,
                m.name AS manufacturer_name,
                b.cover_photo_id, b.cover_scan_id,
                (SELECT ph.storage_key FROM photos ph WHERE ph.id = b.cover_photo_id) AS cover_photo_key,
                (SELECT fp.id FROM figure_photos fp
                   WHERE fp.figure_id = f.id
                   ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
                   LIMIT 1) AS catalog_cover_photo_id
         FROM merged b
         JOIN figures f ON f.id = b.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         ORDER BY f.name",
    )
    .bind(viewer)
    .bind(them.id)
    .bind(hide_nsfw)
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
            is_nsfw: r.is_nsfw,
            cover_photo_id: r.cover_photo_id,
            cover_scan_id: r.cover_scan_id,
            cover_photo_key: r.cover_photo_key,
            catalog_cover_photo_id: r.catalog_cover_photo_id,
        };
        match r.bucket.as_str() {
            "common" => common.push(entry),
            "yours" => yours_only.push(entry),
            "theirs" => theirs_only.push(entry),
            _ => {}
        }
    }

    // Series & manufacturer diffs (FULL OUTER JOIN per facet) → the "shared
    // terrain" lists + the affinity score. Same NSFW gate as the figure diff.
    let series_rows: Vec<FacetRow> = sqlx::query_as(
        "WITH
            ys AS (SELECT fs.series_id AS k, COUNT(DISTINCT o.figure_id)::bigint AS n
                   FROM owned_items o JOIN figure_series fs ON fs.figure_id = o.figure_id
                   WHERE o.user_id = $1
                   GROUP BY fs.series_id),
            ts AS (SELECT fs.series_id AS k, COUNT(DISTINCT o.figure_id)::bigint AS n
                   FROM owned_items o JOIN figures f ON f.id = o.figure_id
                   JOIN figure_series fs ON fs.figure_id = f.id
                   WHERE o.user_id = $2 AND ($3 = FALSE OR f.is_nsfw = FALSE)
                   GROUP BY fs.series_id)
         SELECT CASE WHEN ys.k IS NULL THEN 'theirs' WHEN ts.k IS NULL THEN 'yours' ELSE 'common' END AS bucket,
                s.name,
                (COALESCE(ys.n, 0) + COALESCE(ts.n, 0))::bigint AS count
         FROM ys FULL OUTER JOIN ts ON ts.k = ys.k
         JOIN series s ON s.id = COALESCE(ys.k, ts.k)
         ORDER BY count DESC, s.name",
    )
    .bind(viewer)
    .bind(them.id)
    .bind(hide_nsfw)
    .fetch_all(&state.pool)
    .await?;

    let maker_rows: Vec<FacetRow> = sqlx::query_as(
        "WITH
            ym AS (SELECT f.manufacturer_id AS k, COUNT(DISTINCT o.figure_id)::bigint AS n
                   FROM owned_items o JOIN figures f ON f.id = o.figure_id
                   WHERE o.user_id = $1 AND f.manufacturer_id IS NOT NULL
                   GROUP BY f.manufacturer_id),
            tm AS (SELECT f.manufacturer_id AS k, COUNT(DISTINCT o.figure_id)::bigint AS n
                   FROM owned_items o JOIN figures f ON f.id = o.figure_id
                   WHERE o.user_id = $2 AND f.manufacturer_id IS NOT NULL
                     AND ($3 = FALSE OR f.is_nsfw = FALSE)
                   GROUP BY f.manufacturer_id)
         SELECT CASE WHEN ym.k IS NULL THEN 'theirs' WHEN tm.k IS NULL THEN 'yours' ELSE 'common' END AS bucket,
                man.name,
                (COALESCE(ym.n, 0) + COALESCE(tm.n, 0))::bigint AS count
         FROM ym FULL OUTER JOIN tm ON tm.k = ym.k
         JOIN manufacturers man ON man.id = COALESCE(ym.k, tm.k)
         ORDER BY count DESC, man.name",
    )
    .bind(viewer)
    .bind(them.id)
    .bind(hide_nsfw)
    .fetch_all(&state.pool)
    .await?;

    // Affinity — Sørensen–Dice per dimension, weighted (shared series & makers
    // signal taste far more than owning the exact same SKU). 0 when both sides
    // are empty on every dimension.
    fn dice(common: f64, a_total: f64, b_total: f64) -> f64 {
        if a_total + b_total > 0.0 {
            2.0 * common / (a_total + b_total)
        } else {
            0.0
        }
    }
    fn bucket_total(rows: &[FacetRow], side: &str) -> f64 {
        rows.iter()
            .filter(|r| r.bucket == "common" || r.bucket == side)
            .count() as f64
    }
    let common_series = series_rows.iter().filter(|r| r.bucket == "common").count() as f64;
    let common_makers = maker_rows.iter().filter(|r| r.bucket == "common").count() as f64;
    let series_dice = dice(
        common_series,
        bucket_total(&series_rows, "yours"),
        bucket_total(&series_rows, "theirs"),
    );
    let maker_dice = dice(
        common_makers,
        bucket_total(&maker_rows, "yours"),
        bucket_total(&maker_rows, "theirs"),
    );
    let figure_dice = dice(
        common.len() as f64,
        (common.len() + yours_only.len()) as f64,
        (common.len() + theirs_only.len()) as f64,
    );
    let affinity =
        (100.0 * (0.50 * series_dice + 0.30 * maker_dice + 0.20 * figure_dice)).round() as u8;

    let shared_series: Vec<SharedFacet> = series_rows
        .iter()
        .filter(|r| r.bucket == "common")
        .take(12)
        .map(|r| SharedFacet {
            name: r.name.clone(),
            count: r.count,
        })
        .collect();
    let shared_manufacturers: Vec<SharedFacet> = maker_rows
        .iter()
        .filter(|r| r.bucket == "common")
        .take(12)
        .map(|r| SharedFacet {
            name: r.name.clone(),
            count: r.count,
        })
        .collect();

    // Value KPIs — yours always (it's your own data); theirs only when they've
    // opted into publishing their collection value.
    let yours_value = collection_value(&state.pool, viewer, false).await?;
    let theirs_value = if them.public_profile_show_value {
        collection_value(&state.pool, them.id, hide_nsfw).await?
    } else {
        Vec::new()
    };

    Ok(Json(CompareResponse {
        them: PublicUserCard {
            id: them.id,
            username: them.username,
            display_name: them.display_name,
            avatar_url: them.avatar_url,
            locale: them.locale,
            member_since: them.created_at,
        },
        affinity,
        common,
        yours_only,
        theirs_only,
        shared_series,
        shared_manufacturers,
        value: ComparedValue {
            yours: yours_value,
            theirs: theirs_value,
        },
    }))
}

// --- GET /api/currencies -----------------------------------------------------

/// The single supported-currency list (`domain::currency::SUPPORTED`) so the
/// SPA renders its currency pickers from the server's source of truth instead
/// of a hard-coded copy. Static + non-sensitive, so no auth.
async fn list_currencies() -> Json<&'static [&'static str]> {
    Json(crate::domain::currency::SUPPORTED)
}

// --- router ------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/u/{slug}", get(get_public_profile))
        .route("/me/profile", patch_method(patch_my_profile))
        .route("/compare/{slug}", get(compare))
        .route("/currencies", get(list_currencies))
}
