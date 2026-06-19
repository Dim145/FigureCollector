//! Appearance-tag helpers — shared by the ambiance naming, the catalogue tag
//! filter, and the tag facets. Tags come from the WD-Tagger worker as a single
//! comma-separated string per figure (`figures.visual_tags`), e.g.
//! `"1girl, elf, pink dress, …"`.

use std::collections::BTreeSet;

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;

/// WD-Tagger tags that describe almost every figure → useless as a filter or a
/// chip. Hidden from the facet list and the figure-page chips, but still
/// *searchable* (a `?tag=1girl` filter still works). Lowercase, matched exactly.
pub const GENERIC_TAGS: &[&str] = &[
    "1girl",
    "2girls",
    "3girls",
    "4girls",
    "6+girls",
    "multiple girls",
    "1boy",
    "2boys",
    "multiple boys",
    "solo",
    "solo focus",
    "looking at viewer",
    "looking away",
    "looking to the side",
    "looking back",
    "simple background",
    "white background",
    "grey background",
    "gray background",
    "black background",
    "transparent background",
    "gradient background",
    "full body",
    "upper body",
    "lower body",
    "cowboy shot",
    "portrait",
    "standing",
    "blush",
    "smile",
    "open mouth",
    "closed mouth",
    "parted lips",
    "holding",
    "official art",
    "artist name",
    "signature",
    "watermark",
    "web address",
    "english text",
    "commentary",
    "commentary request",
];

/// Split a figure's `visual_tags` string into a deduped set of lowercased tags
/// (empty when untagged). Single source of truth for tag parsing.
pub fn parse(raw: &Option<String>) -> BTreeSet<String> {
    raw.as_deref()
        .map(|s| {
            s.split(',')
                .map(|t| t.trim().to_lowercase())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Is this a generic, non-distinctive tag (hidden from facets + chips)?
pub fn is_generic(tag: &str) -> bool {
    GENERIC_TAGS.contains(&tag)
}

/// One catalogue tag + how many figures carry it.
#[derive(Debug, Clone, Serialize)]
pub struct TagFacet {
    pub tag: String,
    pub count: i64,
}

/// Distinct appearance tags across the catalogue with figure counts, busiest
/// first — drives the catalogue's tag picker. Generic tags are dropped and the
/// list is capped to `limit` (popular-first), so on a large catalogue only the
/// genuinely common tags survive while a small one still shows what it has.
/// NSFW figures are excluded so a hide-viewer never sees adult tags surfaced as
/// a facet; the tag *filter* itself still honours the per-viewer NSFW pref via
/// `figure::list`.
pub async fn facets(pool: &PgPool, limit: usize) -> AppResult<Vec<TagFacet>> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT lower(trim(tag)) AS tag, count(*)::bigint AS n
         FROM figures f,
              unnest(string_to_array(f.visual_tags, ',')) AS tag
         WHERE f.visual_tags IS NOT NULL
           AND f.visual_tags <> ''
           AND NOT f.is_nsfw
         GROUP BY lower(trim(tag))
         ORDER BY n DESC, tag ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter(|(tag, _)| !tag.is_empty() && !is_generic(tag))
        .take(limit)
        .map(|(tag, count)| TagFacet { tag, count })
        .collect())
}

/// "Collection DNA" — the appearance tags that recur most across ONE user's
/// owned figures, popular-first, generic tags dropped, capped to `limit`. The
/// second return value is the number of owned figures carrying at least one
/// tag: the denominator the SPA uses to read each count as a share ("appears
/// on N% of your figures"). Unlike `facets`, NSFW figures are *included* — this
/// is the owner looking at their own shelf, not a public facet. Reuses the same
/// `{tag, count}` shape as the catalogue facets so the SPA renders both alike.
pub async fn collection_dna(
    pool: &PgPool,
    user_id: Uuid,
    limit: usize,
) -> AppResult<(Vec<TagFacet>, i64)> {
    // count(DISTINCT figure) — a figure carrying the same tag twice (merged
    // across its images) must only count once, or the share would exceed 100%.
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT lower(trim(tag)) AS tag, count(DISTINCT o.figure_id)::bigint AS n
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id,
              unnest(string_to_array(f.visual_tags, ',')) AS tag
         WHERE o.user_id = $1
           AND f.visual_tags IS NOT NULL
           AND f.visual_tags <> ''
         GROUP BY lower(trim(tag))
         ORDER BY n DESC, tag ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // Denominator: owned figures with at least one tag. Distinct on figure_id
    // because a user could (in principle) own duplicates of the same figure.
    let (pieces,): (i64,) = sqlx::query_as(
        "SELECT count(DISTINCT o.figure_id)::bigint
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1
           AND f.visual_tags IS NOT NULL
           AND f.visual_tags <> ''",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let dna = rows
        .into_iter()
        .filter(|(tag, _)| !tag.is_empty() && !is_generic(tag))
        .take(limit)
        .map(|(tag, count)| TagFacet { tag, count })
        .collect();
    Ok((dna, pieces))
}
