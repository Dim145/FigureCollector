use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260525000001_perf_indexes.sql");

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
                "DROP INDEX IF EXISTS notification_dedup_sent_at_idx;
                 DROP INDEX IF EXISTS preorders_release_status_idx;
                 DROP INDEX IF EXISTS owned_items_figure_user_idx;
                 DROP INDEX IF EXISTS figure_characters_figure_id_idx;
                 DROP INDEX IF EXISTS figure_series_figure_id_idx;",
            )
            .await?;
        Ok(())
    }
}
