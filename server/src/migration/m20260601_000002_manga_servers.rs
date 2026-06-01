use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260601000002_manga_servers.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Best-effort reverse: re-add the free-form column (empty — the old
        // values are not restored) and drop the registry wiring.
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS manga_base_url TEXT; \
                 ALTER TABLE users DROP COLUMN IF EXISTS manga_server_id; \
                 DROP TABLE IF EXISTS manga_servers;",
            )
            .await?;
        Ok(())
    }
}
