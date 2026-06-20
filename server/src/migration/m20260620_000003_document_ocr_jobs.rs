use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260620000003_document_ocr_jobs.sql");

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
                "DROP TRIGGER IF EXISTS document_ocr_jobs_notify ON document_ocr_jobs; \
                 DROP FUNCTION IF EXISTS fc_notify_ocr_changed(); \
                 DROP TABLE IF EXISTS document_ocr_jobs;",
            )
            .await?;
        Ok(())
    }
}
