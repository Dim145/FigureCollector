use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

// NB: file renamed to a unique version prefix (was also 20260620000001, which
// collided with owned_documents_parsed and broke sqlx-based tooling / tests —
// sqlx keys its migration table on the numeric prefix). The sea-orm migration
// NAME is the module name (DeriveMigrationName), unchanged, so already-applied
// databases are unaffected. This migration only ALTERs owned_items, so its
// position within the 2026-06-20 batch is irrelevant.
const SQL_UP: &str = include_str!("../../migrations/20260620000004_owned_trading.sql");

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
                "DROP INDEX IF EXISTS owned_items_for_sale_idx;
                 ALTER TABLE owned_items
                     DROP COLUMN IF EXISTS for_sale,
                     DROP COLUMN IF EXISTS for_trade,
                     DROP COLUMN IF EXISTS asking_price_amount,
                     DROP COLUMN IF EXISTS asking_price_currency,
                     DROP COLUMN IF EXISTS sale_note;",
            )
            .await?;
        Ok(())
    }
}
