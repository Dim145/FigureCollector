//! Catalogue aggregation — the read-only queries behind the `/catalogue`
//! redesign's two new endpoints.
//!
//!   - [`facets`] powers the left facet rail, the explore-by-maker/série bento
//!     and the "popular" search proxy: one GROUP-BY per dimension over
//!     `figures`, busiest first, capped.
//!   - [`discover`] powers the curated rails (recently added, upcoming
//!     pre-orders, "from your favourite studios").
//!
//! Both honour the per-viewer NSFW preference exactly like `figure::list` and
//! the tag facets: an `exclude_nsfw` flag, resolved by the route from the
//! viewer's `nsfw_visibility`, that adds `NOT f.is_nsfw` to every figure scan.
//! Everything here is SELECT-only.

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::figure::{
    FIGURE_COLUMNS_PREFIXED, FIGURE_NAME_JOINS, FIGURE_NAME_PROJECTION, Figure,
};
use super::tags;
use crate::error::AppResult;

/// How many rows each facet dimension is capped to.
const FACET_LIMIT: i64 = 50;
/// How many tag facets to surface (matches the catalogue tag picker cap).
const TAG_LIMIT: usize = 40;
/// How many figures each discovery rail carries.
const RAIL_LIMIT: i64 = 12;
/// How many "favourite studios" (top owned manufacturers) to surface.
const FAVE_MAKER_LIMIT: i64 = 6;

// =============================================================================
// Facets
// =============================================================================

/// One manufacturer / series / character facet — the entity plus how many
/// catalogue figures it carries. `slug` is `Option` to mirror the entity
/// tables, though in practice every row has one.
#[derive(Debug, Clone, Serialize)]
pub struct EntityFacet {
    pub id: Uuid,
    pub slug: Option<String>,
    pub name: String,
    pub count: i64,
}

/// One distinct `figures.scale` value + figure count.
#[derive(Debug, Clone, Serialize)]
pub struct ScaleFacet {
    pub value: String,
    pub count: i64,
}

/// One `figure_type` slug + figure count. `id` is the type slug (e.g.
/// `"scale"`, `"nendoroid"`) — the SPA already maps that to a localized label.
#[derive(Debug, Clone, Serialize)]
pub struct TypeFacet {
    pub id: String,
    pub count: i64,
}

/// The full aggregated facet set, every list busiest-first and capped.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogueFacets {
    pub manufacturers: Vec<EntityFacet>,
    pub series: Vec<EntityFacet>,
    pub characters: Vec<EntityFacet>,
    pub scales: Vec<ScaleFacet>,
    pub types: Vec<TypeFacet>,
    pub tags: Vec<tags::TagFacet>,
}

/// Aggregate catalogue facets across all dimensions. Global counts (not
/// live-filtered by other selections) — correct for v1. NSFW figures drop when
/// `exclude_nsfw`, so a hide-viewer never sees adult-only makers/series/etc.
/// surfaced as a facet, exactly like [`tags::facets`].
pub async fn facets(pool: &PgPool, exclude_nsfw: bool) -> AppResult<CatalogueFacets> {
    // A single boolean bind ($1) gates NSFW the same way in every query:
    // `(NOT $1) OR (NOT f.is_nsfw)` keeps SFW rows always, NSFW rows only when
    // the viewer allows them. Lets the planner reuse the same plan shape.
    let manufacturers: Vec<EntityFacet> = sqlx::query_as::<_, (Uuid, Option<String>, String, i64)>(
        "SELECT m.id, m.slug, m.name, count(*)::bigint AS n
         FROM figures f
         JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE ((NOT $1) OR (NOT f.is_nsfw))
         GROUP BY m.id, m.slug, m.name
         ORDER BY n DESC, m.name ASC
         LIMIT $2",
    )
    .bind(exclude_nsfw)
    .bind(FACET_LIMIT)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, slug, name, count)| EntityFacet { id, slug, name, count })
    .collect();

    let series: Vec<EntityFacet> = sqlx::query_as::<_, (Uuid, Option<String>, String, i64)>(
        "SELECT s.id, s.slug, s.name, count(*)::bigint AS n
         FROM figure_series fs
         JOIN figures f ON f.id = fs.figure_id
         JOIN series s ON s.id = fs.series_id
         WHERE ((NOT $1) OR (NOT f.is_nsfw))
         GROUP BY s.id, s.slug, s.name
         ORDER BY n DESC, s.name ASC
         LIMIT $2",
    )
    .bind(exclude_nsfw)
    .bind(FACET_LIMIT)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, slug, name, count)| EntityFacet { id, slug, name, count })
    .collect();

    let characters: Vec<EntityFacet> = sqlx::query_as::<_, (Uuid, Option<String>, String, i64)>(
        "SELECT c.id, c.slug, c.name, count(*)::bigint AS n
         FROM figure_characters fc
         JOIN figures f ON f.id = fc.figure_id
         JOIN characters c ON c.id = fc.character_id
         WHERE ((NOT $1) OR (NOT f.is_nsfw))
         GROUP BY c.id, c.slug, c.name
         ORDER BY n DESC, c.name ASC
         LIMIT $2",
    )
    .bind(exclude_nsfw)
    .bind(FACET_LIMIT)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, slug, name, count)| EntityFacet { id, slug, name, count })
    .collect();

    let scales: Vec<ScaleFacet> = sqlx::query_as::<_, (String, i64)>(
        "SELECT f.scale, count(*)::bigint AS n
         FROM figures f
         WHERE f.scale IS NOT NULL
           AND trim(f.scale) <> ''
           AND ((NOT $1) OR (NOT f.is_nsfw))
         GROUP BY f.scale
         ORDER BY n DESC, f.scale ASC
         LIMIT $2",
    )
    .bind(exclude_nsfw)
    .bind(FACET_LIMIT)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(value, count)| ScaleFacet { value, count })
    .collect();

    let types: Vec<TypeFacet> = sqlx::query_as::<_, (String, i64)>(
        "SELECT f.figure_type, count(*)::bigint AS n
         FROM figures f
         WHERE ((NOT $1) OR (NOT f.is_nsfw))
         GROUP BY f.figure_type
         ORDER BY n DESC, f.figure_type ASC
         LIMIT $2",
    )
    .bind(exclude_nsfw)
    .bind(FACET_LIMIT)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, count)| TypeFacet { id, count })
    .collect();

    // Tag facets: reuse the existing helper verbatim. It already excludes NSFW
    // and drops generic/long-tail tags; the facet rail only ever shows tags to
    // a hide-viewer's baseline, so we don't widen it for NSFW-allowing viewers.
    let tags = tags::facets(pool, TAG_LIMIT).await?;

    Ok(CatalogueFacets {
        manufacturers,
        series,
        characters,
        scales,
        types,
        tags,
    })
}

// =============================================================================
// Discover
// =============================================================================

/// One of the viewer's favourite studios (a manufacturer they own figures of),
/// with how many of their owned items it accounts for.
#[derive(Debug, Clone, Serialize)]
pub struct FavoriteMaker {
    pub name: String,
    pub slug: Option<String>,
    pub count: i64,
}

/// The "from your favourite studios" rail: the viewer's top owned manufacturers
/// plus recent catalogue figures from those makers. Both empty when the viewer
/// owns nothing (the SPA hides the rail).
#[derive(Debug, Clone, Serialize)]
pub struct FavoriteStudios {
    pub makers: Vec<FavoriteMaker>,
    pub figures: Vec<Figure>,
}

/// The full discovery payload — three curated rails. `Figure` is the exact same
/// DTO `figure::list` returns (same column projection + joined names + primary
/// photo), so the SPA's FigureCard renders these identically.
#[derive(Debug, Clone, Serialize)]
pub struct Discover {
    pub recently_added: Vec<Figure>,
    pub upcoming_preorders: Vec<Figure>,
    pub favorite_studios: FavoriteStudios,
}

/// Build the canonical list-projection figure SELECT (matching `figure::list`):
/// the prefixed columns + joined entity names + the correlated primary-photo
/// subquery. `tail` is appended after `WHERE TRUE` (extra predicates + ORDER /
/// LIMIT). Keeping the projection identical guarantees the same `Figure` DTO.
fn figure_select(tail: &str) -> String {
    format!(
        "SELECT {FIGURE_COLUMNS_PREFIXED}{FIGURE_NAME_PROJECTION},
                (SELECT fp.id FROM figure_photos fp
                 WHERE fp.figure_id = f.id
                 ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
                 LIMIT 1) AS primary_photo_id
         FROM figures f {FIGURE_NAME_JOINS}
         WHERE TRUE {tail}"
    )
}

/// Assemble the discovery rails for `user_id`. `exclude_nsfw` gates every
/// figure scan the same as the figures list.
pub async fn discover(pool: &PgPool, user_id: Uuid, exclude_nsfw: bool) -> AppResult<Discover> {
    let nsfw = if exclude_nsfw { " AND NOT f.is_nsfw" } else { "" };

    // Recently added: newest catalogue rows first.
    let recently_added: Vec<Figure> = sqlx::query_as::<_, Figure>(&figure_select(&format!(
        "{nsfw} ORDER BY f.created_at DESC LIMIT $1"
    )))
    .bind(RAIL_LIMIT)
    .fetch_all(pool)
    .await?;

    // Upcoming pre-orders: figures whose release is still in the future, soonest
    // first. `current_date` is the DB's date — matches the figure page's logic.
    let upcoming_preorders: Vec<Figure> = sqlx::query_as::<_, Figure>(&figure_select(&format!(
        "{nsfw} AND f.release_date IS NOT NULL AND f.release_date > current_date \
         ORDER BY f.release_date ASC LIMIT $1"
    )))
    .bind(RAIL_LIMIT)
    .fetch_all(pool)
    .await?;

    // Favourite studios: the viewer's top manufacturers by owned-item count.
    // Distinct figure per owned item is irrelevant here — owning the same
    // figure twice legitimately weights that maker higher.
    let makers: Vec<FavoriteMaker> = sqlx::query_as::<_, (String, Option<String>, i64)>(
        "SELECT m.name, m.slug, count(*)::bigint AS n
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id
         JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
         GROUP BY m.id, m.name, m.slug
         ORDER BY n DESC, m.name ASC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(FAVE_MAKER_LIMIT)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(name, slug, count)| FavoriteMaker { name, slug, count })
    .collect();

    // Recent catalogue figures from those makers (newest first). Empty when the
    // viewer owns nothing tied to a manufacturer → the SPA hides the rail.
    let fave_figures: Vec<Figure> = if makers.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, Figure>(&figure_select(&format!(
            "{nsfw} AND f.manufacturer_id IN (
                 SELECT f2.manufacturer_id
                 FROM owned_items o2
                 JOIN figures f2 ON f2.id = o2.figure_id
                 WHERE o2.user_id = $1 AND f2.manufacturer_id IS NOT NULL
             ) ORDER BY f.created_at DESC LIMIT $2"
        )))
        .bind(user_id)
        .bind(RAIL_LIMIT)
        .fetch_all(pool)
        .await?
    };

    Ok(Discover {
        recently_added,
        upcoming_preorders,
        favorite_studios: FavoriteStudios {
            makers,
            figures: fave_figures,
        },
    })
}
