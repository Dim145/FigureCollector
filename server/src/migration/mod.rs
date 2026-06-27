//! Sea-ORM migration runner.
//!
//! Each migration is a thin Rust wrapper around the canonical .sql file in
//! `server/migrations/`. `include_str!` keeps the SQL as the single source of
//! truth while sea-orm-migration handles ordering, tracking (`seaql_migrations`
//! table), and the `up` / `down` lifecycle.
//!
//! All migrations are written to be **idempotent** (`CREATE TABLE IF NOT
//! EXISTS`, `CREATE OR REPLACE TRIGGER`, `ALTER TABLE ADD COLUMN IF NOT
//! EXISTS`) so running them on a database already populated by the old
//! `sqlx::migrate!` system is a safe no-op.

use sea_orm_migration::prelude::*;

mod m20260524_000001_initial_schema;
mod m20260524_000002_figurine_domain;
mod m20260524_000003_photos_and_social;
mod m20260524_000004_external_lookups;
mod m20260524_000005_activity_feed;
mod m20260524_000006_scans;
mod m20260524_000007_achievements;
mod m20260524_000008_figure_photos_and_covers;
mod m20260524_000009_preorder_link;
mod m20260524_000010_nsfw;
mod m20260524_000011_entity_metadata;
mod m20260524_000012_preorder_tracking;
mod m20260524_000013_owned_shipping;
mod m20260524_000014_user_preferred_currency;
mod m20260524_000015_achievement_trigger_figure;
mod m20260524_000016_public_profile_show_nsfw;
mod m20260524_000017_notifications;
mod m20260525_000001_perf_indexes;
mod m20260526_000001_preorder_deposit;
mod m20260526_000002_preorder_cancellation;
mod m20260526_000003_preorder_delivery_estimate;
mod m20260526_000004_figure_types;
mod m20260526_000005_stores;
mod m20260526_000006_figure_stores;
mod m20260526_000007_figure_type_fk;
mod m20260528_000001_workers;
mod m20260529_000001_figure_type_color;
mod m20260529_000002_owned_item_value;
mod m20260530_000001_collection_locations;
mod m20260530_000002_owned_item_sort_order;
mod m20260530_000003_scan_progress_notify;
mod m20260530_000004_follows;
mod m20260530_000005_notification_prefs;
mod m20260530_000006_wishlist_drop_owned;
mod m20260530_000007_external_trgm;
mod m20260531_000001_owned_documents;
mod m20260531_000002_gift_list;
mod m20260601_000001_manga_link;
mod m20260601_000002_manga_servers;
mod m20260602_000001_scan_queue;
mod m20260603_000001_series_manga_mal_id;
mod m20260606_000001_figure_store_link;
mod m20260607_000001_app_settings;
mod m20260607_000002_figure_provider_prices;
mod m20260610_000001_server_job_runs;
mod m20260610_000002_figure_price_history;
mod m20260611_000001_pricing_frozen_fx;
mod m20260613_000001_visual_search;
mod m20260613_000002_worker_embed_kind;
mod m20260617_000001_calendar_token;
mod m20260618_000001_clip_search;
mod m20260618_000002_visual_tags;
mod m20260620_000001_owned_documents_parsed;
mod m20260620_000001_owned_trading;
mod m20260620_000002_collection_layout;
mod m20260620_000003_document_ocr_jobs;
mod m20260625_000001_preorder_balance_paid;
mod m20260627_000001_server_job_runs_changed;
mod m20260627_000002_service_heartbeats;
mod m20260627_000003_jobrun_actor_and_backfill;
mod m20260627_000004_figure_shop_stock;
mod m20260627_000005_owned_photo_tags;
mod m20260627_000006_owned_provenance;
mod m20260627_000007_vitrine_share;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260524_000001_initial_schema::Migration),
            Box::new(m20260524_000002_figurine_domain::Migration),
            Box::new(m20260524_000003_photos_and_social::Migration),
            Box::new(m20260524_000004_external_lookups::Migration),
            Box::new(m20260524_000005_activity_feed::Migration),
            Box::new(m20260524_000006_scans::Migration),
            Box::new(m20260524_000007_achievements::Migration),
            Box::new(m20260524_000008_figure_photos_and_covers::Migration),
            Box::new(m20260524_000009_preorder_link::Migration),
            Box::new(m20260524_000010_nsfw::Migration),
            Box::new(m20260524_000011_entity_metadata::Migration),
            Box::new(m20260524_000012_preorder_tracking::Migration),
            Box::new(m20260524_000013_owned_shipping::Migration),
            Box::new(m20260524_000014_user_preferred_currency::Migration),
            Box::new(m20260524_000015_achievement_trigger_figure::Migration),
            Box::new(m20260524_000016_public_profile_show_nsfw::Migration),
            Box::new(m20260524_000017_notifications::Migration),
            Box::new(m20260525_000001_perf_indexes::Migration),
            Box::new(m20260526_000001_preorder_deposit::Migration),
            Box::new(m20260526_000002_preorder_cancellation::Migration),
            Box::new(m20260526_000003_preorder_delivery_estimate::Migration),
            Box::new(m20260526_000004_figure_types::Migration),
            Box::new(m20260526_000005_stores::Migration),
            Box::new(m20260526_000006_figure_stores::Migration),
            Box::new(m20260526_000007_figure_type_fk::Migration),
            Box::new(m20260528_000001_workers::Migration),
            Box::new(m20260529_000001_figure_type_color::Migration),
            Box::new(m20260529_000002_owned_item_value::Migration),
            Box::new(m20260530_000001_collection_locations::Migration),
            Box::new(m20260530_000002_owned_item_sort_order::Migration),
            Box::new(m20260530_000003_scan_progress_notify::Migration),
            Box::new(m20260530_000004_follows::Migration),
            Box::new(m20260530_000005_notification_prefs::Migration),
            Box::new(m20260530_000006_wishlist_drop_owned::Migration),
            Box::new(m20260530_000007_external_trgm::Migration),
            Box::new(m20260531_000001_owned_documents::Migration),
            Box::new(m20260531_000002_gift_list::Migration),
            Box::new(m20260601_000001_manga_link::Migration),
            Box::new(m20260601_000002_manga_servers::Migration),
            Box::new(m20260602_000001_scan_queue::Migration),
            Box::new(m20260603_000001_series_manga_mal_id::Migration),
            Box::new(m20260606_000001_figure_store_link::Migration),
            Box::new(m20260607_000001_app_settings::Migration),
            Box::new(m20260607_000002_figure_provider_prices::Migration),
            Box::new(m20260610_000001_server_job_runs::Migration),
            Box::new(m20260610_000002_figure_price_history::Migration),
            Box::new(m20260611_000001_pricing_frozen_fx::Migration),
            Box::new(m20260613_000001_visual_search::Migration),
            Box::new(m20260613_000002_worker_embed_kind::Migration),
            Box::new(m20260617_000001_calendar_token::Migration),
            Box::new(m20260618_000001_clip_search::Migration),
            Box::new(m20260618_000002_visual_tags::Migration),
            Box::new(m20260620_000001_owned_documents_parsed::Migration),
            Box::new(m20260620_000001_owned_trading::Migration),
            Box::new(m20260620_000002_collection_layout::Migration),
            Box::new(m20260620_000003_document_ocr_jobs::Migration),
            Box::new(m20260625_000001_preorder_balance_paid::Migration),
            Box::new(m20260627_000001_server_job_runs_changed::Migration),
            Box::new(m20260627_000002_service_heartbeats::Migration),
            Box::new(m20260627_000003_jobrun_actor_and_backfill::Migration),
            Box::new(m20260627_000004_figure_shop_stock::Migration),
            Box::new(m20260627_000005_owned_photo_tags::Migration),
            Box::new(m20260627_000006_owned_provenance::Migration),
            Box::new(m20260627_000007_vitrine_share::Migration),
        ]
    }
}
