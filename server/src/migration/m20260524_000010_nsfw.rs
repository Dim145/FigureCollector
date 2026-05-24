use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260524000010_nsfw.sql");

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
                "ALTER TABLE users \
                    DROP CONSTRAINT IF EXISTS users_nsfw_visibility_chk, \
                    DROP COLUMN IF EXISTS nsfw_visibility; \
                 ALTER TABLE figures DROP COLUMN IF EXISTS is_nsfw; \
                 DROP INDEX IF EXISTS figures_nsfw_idx;",
            )
            .await?;
        Ok(())
    }
}
