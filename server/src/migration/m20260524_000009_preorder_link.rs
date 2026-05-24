use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260524000009_preorder_link.sql");

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
                "ALTER TABLE preorders DROP COLUMN IF EXISTS owned_item_id; \
                 DROP INDEX IF EXISTS preorders_owned_item_idx;",
            )
            .await?;
        Ok(())
    }
}
