use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260526000006_figure_stores.sql");

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
                "DROP TRIGGER IF EXISTS preorders_sync_store ON preorders;
                 DROP TRIGGER IF EXISTS owned_items_sync_store ON owned_items;
                 DROP FUNCTION IF EXISTS sync_figure_store_from_preorder();
                 DROP FUNCTION IF EXISTS sync_figure_store_from_owned();
                 DROP INDEX IF EXISTS figure_stores_store_idx;
                 DROP TABLE IF EXISTS figure_stores;",
            )
            .await?;
        Ok(())
    }
}
