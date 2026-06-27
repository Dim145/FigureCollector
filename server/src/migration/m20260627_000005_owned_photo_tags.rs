use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260627000005_owned_photo_tags.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the column; leave figure_id nullable (re-adding NOT NULL could
        // fail if owned-photo rows exist, and it's harmless to keep relaxed).
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE photos DROP COLUMN IF EXISTS visual_tags;")
            .await?;
        Ok(())
    }
}
