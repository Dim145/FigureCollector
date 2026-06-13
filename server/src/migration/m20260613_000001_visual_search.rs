use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260613000001_visual_search.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop our tables + the workers column, but leave the `vector`
        // extension installed — other features may come to rely on it (mirrors
        // how external_trgm leaves pg_trgm in place).
        manager
            .get_connection()
            .execute_unprepared(
                "DROP TABLE IF EXISTS figure_embedding_queue;
                 DROP TABLE IF EXISTS figure_embeddings;
                 ALTER TABLE workers DROP COLUMN IF EXISTS capabilities;",
            )
            .await?;
        Ok(())
    }
}
