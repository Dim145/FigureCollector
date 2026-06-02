use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260602000001_scan_queue.sql");

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
                "ALTER TABLE scans DROP COLUMN IF EXISTS attempts; \
                 ALTER TABLE scans DROP COLUMN IF EXISTS finished_at; \
                 ALTER TABLE scans DROP COLUMN IF EXISTS claimed_at; \
                 ALTER TABLE scans DROP COLUMN IF EXISTS worker_id;",
            )
            .await?;
        Ok(())
    }
}
