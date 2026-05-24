use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260524000011_entity_metadata.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the added columns + indexes. Existing columns from migration 002
        // (logo_url, cover_url, portrait_url, anilist_id/mal_id on series,
        // origin, etc.) are not touched — they predate this migration.
        manager
            .get_connection()
            .execute_unprepared(
                "DROP INDEX IF EXISTS characters_mal_id_uq; \
                 DROP INDEX IF EXISTS characters_anilist_id_uq; \
                 DROP INDEX IF EXISTS series_mal_id_uq; \
                 DROP INDEX IF EXISTS series_anilist_id_uq; \
                 ALTER TABLE characters \
                    DROP COLUMN IF EXISTS image_key, \
                    DROP COLUMN IF EXISTS mal_id, \
                    DROP COLUMN IF EXISTS anilist_id, \
                    DROP COLUMN IF EXISTS external_url, \
                    DROP COLUMN IF EXISTS description; \
                 ALTER TABLE series \
                    DROP COLUMN IF EXISTS image_key, \
                    DROP COLUMN IF EXISTS external_url; \
                 ALTER TABLE manufacturers \
                    DROP COLUMN IF EXISTS image_key, \
                    DROP COLUMN IF EXISTS website_url, \
                    DROP COLUMN IF EXISTS description;",
            )
            .await?;
        Ok(())
    }
}
