//! Slip statistics — how late a maker's pre-orders actually run.
//!
//! Every date change on a pre-order is already journaled in
//! `preorder_date_history` (previous → new, with a source), but it was only
//! ever read back as a per-piece log. Aggregated, the same rows answer the
//! question that decides whether to pre-order at all: *this maker has slipped
//! a median of ten weeks across your last six pre-orders.*
//!
//! **What counts as a slip.** The *net* move of one pre-order:
//! `release_date_current - release_date_original`, one number per pre-order,
//! the same measure `year_in_review`'s "longest slip" reports.
//!
//! It used to sum the forward jumps in `preorder_date_history` and drop the
//! backward ones, on the reasoning that a date pulled earlier is good news
//! rather than slip. That reasoning holds for a real reschedule and breaks on
//! a **correction**: type a purchase date into the release-date field, fix it
//! seconds later, and the repair is a forward jump. One pre-order whose real
//! slip was 62 days reported 335 — and because only the forward half of the
//! round trip counted, every corrected typo inflated the maker's statistic
//! permanently. Measuring the endpoints ignores whatever happened between
//! them.
//!
//! **On sample size.** A single-user instance holds tens of pre-orders, not
//! thousands, so a per-(maker × shop) split would routinely compute a "median"
//! from one observation. We therefore aggregate per **maker only** and drop
//! any maker below [`MIN_SAMPLES`].
//!
//! [`overall`] is the deliberate exception — it is the all-makers fallback a
//! young instance still has — so it *does* return a figure below the
//! threshold. That made the two look mutually inconsistent: an empty
//! `by_manufacturer` next to an `overall` median computed from a single slip,
//! where median, p80 and max were necessarily the same number. Every row now
//! carries `reliable`, so the threshold travels with the data instead of
//! living in prose the caller has to have read.

use crate::error::AppResult;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Below this many observed slips we report nothing for a maker — a median of
/// one or two data points is noise wearing a statistic's clothes.
pub const MIN_SAMPLES: i64 = 3;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SlipStat {
    pub manufacturer_id: Option<Uuid>,
    pub manufacturer_name: Option<String>,
    /// Pre-orders that slipped, backing the figures below — one per
    /// pre-order, not one per date change, so it lines up with the
    /// `slip_count` a single pre-order reports.
    pub samples: i64,
    /// Median slip, in days.
    pub median_days: Option<f64>,
    /// 80th-percentile slip, in days — the "plan for this" number.
    pub p80_days: Option<f64>,
    /// Worst net slip observed on any one pre-order, in days.
    pub max_days: Option<f64>,
    /// Whether `samples` reaches [`MIN_SAMPLES`]. When false the figures are
    /// arithmetic, not evidence — on one observation median, p80 and max are
    /// the same number and carry no information about what the next
    /// pre-order will do.
    pub reliable: bool,
}

/// Per-maker slip stats for one user's pre-order history, worst P80 first.
/// A pre-order that ended up no later than announced isn't slip and is left
/// out — pulling it earlier is good news, and averaging it in would cancel
/// exactly the risk being measured.
pub async fn per_manufacturer(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<SlipStat>> {
    Ok(sqlx::query_as::<_, SlipStat>(
        "SELECT m.id   AS manufacturer_id,
                m.name AS manufacturer_name,
                count(*) AS samples,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY (p.release_date_current - p.release_date_original)::double precision) AS median_days,
                percentile_cont(0.8) WITHIN GROUP (ORDER BY (p.release_date_current - p.release_date_original)::double precision) AS p80_days,
                max((p.release_date_current - p.release_date_original)::double precision) AS max_days,
                (count(*) >= $2) AS reliable
         FROM preorders   p
         JOIN owned_items o ON o.id = p.owned_item_id
         JOIN figures     f ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
           AND p.release_date_original IS NOT NULL
           AND p.release_date_current  IS NOT NULL
           AND p.release_date_current > p.release_date_original
         GROUP BY m.id, m.name
         HAVING count(*) >= $2
         ORDER BY p80_days DESC NULLS LAST, samples DESC",
    )
    .bind(user_id)
    .bind(MIN_SAMPLES)
    .fetch_all(pool)
    .await?)
}

/// One overall row across every maker — what a young instance can still say
/// while no single maker has reached [`MIN_SAMPLES`].
pub async fn overall(pool: &PgPool, user_id: Uuid) -> AppResult<SlipStat> {
    let row: Option<SlipStat> = sqlx::query_as::<_, SlipStat>(
        "SELECT NULL::uuid AS manufacturer_id,
                NULL::text AS manufacturer_name,
                count(*) AS samples,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY (p.release_date_current - p.release_date_original)::double precision) AS median_days,
                percentile_cont(0.8) WITHIN GROUP (ORDER BY (p.release_date_current - p.release_date_original)::double precision) AS p80_days,
                max((p.release_date_current - p.release_date_original)::double precision) AS max_days,
                (count(*) >= $2) AS reliable
         FROM preorders   p
         JOIN owned_items o ON o.id = p.owned_item_id
         WHERE o.user_id = $1
           AND p.release_date_original IS NOT NULL
           AND p.release_date_current  IS NOT NULL
           AND p.release_date_current > p.release_date_original",
    )
    .bind(user_id)
    .bind(MIN_SAMPLES)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or(SlipStat {
        manufacturer_id: None,
        manufacturer_name: None,
        samples: 0,
        median_days: None,
        p80_days: None,
        max_days: None,
        reliable: false,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both queries are hand-written strings, so a typo in one is invisible
    /// until a user opens the page — nothing compiles them. Run them against a
    /// real database on an empty collection: Postgres parses the whole
    /// statement whether or not any row matches, which is exactly the check
    /// that was missing.
    /// The case from the report: a release date typed wrong, corrected 43
    /// seconds later. The history holds -274 then +335 days; the real slip is
    /// the 62 days between the announced date and the current one.
    #[sqlx::test]
    async fn a_corrected_typo_is_not_a_slip(pool: PgPool) {
        let user = seed_user(&pool).await;
        let figure = seed_figure(&pool).await;
        let owned = seed_owned(&pool, user, figure).await;
        // original 2026-07-01, current 2026-09-01 — 62 days.
        sqlx::query(
            "INSERT INTO preorders
                 (id, user_id, figure_id, owned_item_id, status,
                  release_date_original, release_date_current)
             VALUES ($1, $2, $3, $4, 'preordered', DATE '2026-07-01', DATE '2026-09-01')",
        )
        .bind(Uuid::now_v7())
        .bind(user)
        .bind(figure)
        .bind(owned)
        .execute(&pool)
        .await
        .unwrap();

        let overall = overall(&pool, user).await.unwrap();
        assert_eq!(overall.samples, 1, "one pre-order slipped, not two events");
        assert_eq!(
            overall.max_days,
            Some(62.0),
            "the +335 jump was a correction of the -274 one, not slip"
        );
        assert!(!overall.reliable, "one pre-order is not evidence");
    }

    /// A pre-order that landed on time, or early, is not slip.
    #[sqlx::test]
    async fn an_on_time_preorder_is_not_counted(pool: PgPool) {
        let user = seed_user(&pool).await;
        let figure = seed_figure(&pool).await;
        let owned = seed_owned(&pool, user, figure).await;
        sqlx::query(
            "INSERT INTO preorders
                 (id, user_id, figure_id, owned_item_id, status,
                  release_date_original, release_date_current)
             VALUES ($1, $2, $3, $4, 'preordered', DATE '2026-07-01', DATE '2026-06-01')",
        )
        .bind(Uuid::now_v7())
        .bind(user)
        .bind(figure)
        .bind(owned)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(overall(&pool, user).await.unwrap().samples, 0);
    }

    async fn seed_user(pool: &PgPool) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO users (id, username, display_name) VALUES ($1, $2, 'T')")
            .bind(id)
            .bind(id.to_string())
            .execute(pool)
            .await
            .unwrap();
        id
    }

    async fn seed_figure(pool: &PgPool) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO figures (id, name, slug, figure_type) VALUES ($1, 'F', $2, 'statue')",
        )
        .bind(id)
        .bind(id.to_string())
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn seed_owned(pool: &PgPool, user: Uuid, figure: Uuid) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO owned_items (id, user_id, figure_id) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(user)
            .bind(figure)
            .execute(pool)
            .await
            .unwrap();
        id
    }

    #[sqlx::test]
    async fn both_queries_parse_and_answer_on_an_empty_collection(pool: PgPool) {
        let user = Uuid::now_v7();

        let overall = overall(&pool, user).await.expect("overall must parse");
        assert_eq!(overall.samples, 0);
        assert_eq!(overall.median_days, None);
        // No slips observed is not "reliable data saying zero".
        assert!(!overall.reliable);

        let per_maker = per_manufacturer(&pool, user)
            .await
            .expect("per_manufacturer must parse");
        assert!(per_maker.is_empty());
    }
}
