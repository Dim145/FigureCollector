use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str =
    include_str!("../../migrations/20260524000008_figure_photos_and_covers.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE owned_items \
                    DROP CONSTRAINT IF EXISTS owned_items_single_cover, \
                    DROP COLUMN IF EXISTS cover_photo_id, \
                    DROP COLUMN IF EXISTS cover_scan_id; \
                 DROP TABLE IF EXISTS figure_photos;",
            )
            .await?;
        Ok(())
    }
}
