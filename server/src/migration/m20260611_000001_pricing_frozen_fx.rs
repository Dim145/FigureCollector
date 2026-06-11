use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260611000001_pricing_frozen_fx.sql");

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
                "ALTER TABLE preorders   DROP COLUMN IF EXISTS price_fx_rate;
                 ALTER TABLE owned_items DROP COLUMN IF EXISTS price_fx_rate;
                 ALTER TABLE owned_items ALTER COLUMN value_currency TYPE TEXT;",
            )
            .await?;
        Ok(())
    }
}
