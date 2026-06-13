use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260613000002_worker_embed_kind.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Revert to the gsplat-only kinds. Any embed-worker rows must go first,
        // or the narrower CHECK would refuse to apply.
        manager
            .get_connection()
            .execute_unprepared(
                "DELETE FROM workers WHERE kind = 'embed';
                 ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_kind_check;
                 ALTER TABLE workers
                     ADD CONSTRAINT workers_kind_check CHECK (kind IN ('cuda', 'metal'));",
            )
            .await?;
        Ok(())
    }
}
