use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str =
    include_str!("../../migrations/20260620000001_owned_documents_parsed.sql");

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
                "ALTER TABLE owned_item_documents \
                 DROP COLUMN IF EXISTS parsed_metadata, \
                 DROP COLUMN IF EXISTS parsed_at;",
            )
            .await?;
        Ok(())
    }
}
