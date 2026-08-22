use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260822000003_condition_reports.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Defects cascade from reports, so one DROP is enough — but be explicit
        // so a partial `up` can still be rolled back.
        manager
            .get_connection()
            .execute_unprepared(
                "DROP TABLE IF EXISTS condition_defects;
                 DROP TABLE IF EXISTS condition_reports;",
            )
            .await?;
        Ok(())
    }
}
