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
        ]
    }
}
