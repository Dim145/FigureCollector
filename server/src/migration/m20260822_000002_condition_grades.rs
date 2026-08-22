use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260822000002_condition_grades.sql");

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
                    DROP COLUMN IF EXISTS condition_item,
                    DROP COLUMN IF EXISTS condition_box,
                    DROP COLUMN IF EXISTS completeness;",
            )
            .await?;
        Ok(())
    }
}
