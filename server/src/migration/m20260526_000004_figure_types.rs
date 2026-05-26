use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260526000004_figure_types.sql");

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
                "DROP TRIGGER IF EXISTS figure_types_touch ON figure_types;
                 DROP FUNCTION IF EXISTS figure_types_touch_updated_at();
                 DROP TABLE IF EXISTS figure_types;",
            )
            .await?;
        Ok(())
    }
}
