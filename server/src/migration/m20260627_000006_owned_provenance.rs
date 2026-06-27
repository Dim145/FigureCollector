use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260627000006_owned_provenance.sql");

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
                "ALTER TABLE owned_items
                    DROP COLUMN IF EXISTS acquisition_source,
                    DROP COLUMN IF EXISTS acquired_from,
                    DROP COLUMN IF EXISTS archive_reason;",
            )
            .await?;
        Ok(())
    }
}
