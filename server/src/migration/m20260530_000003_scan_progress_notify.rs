use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260530000003_scan_progress_notify.sql");

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
                "DROP TRIGGER IF EXISTS scans_notify ON scans; \
                 DROP FUNCTION IF EXISTS fc_notify_scan_changed(); \
                 ALTER TABLE scans DROP COLUMN IF EXISTS progress;",
            )
            .await?;
        Ok(())
    }
}
