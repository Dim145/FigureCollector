use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260526000007_figure_type_fk.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the FK. We deliberately do NOT restore the original CHECK:
        // re-freezing the column to the ten built-ins would fail outright if
        // any figure now uses an admin-created type, and silently dropping
        // those figures isn't acceptable. Rolling back leaves figure_type
        // unconstrained at the DB level (the app still validates on write).
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE figures DROP CONSTRAINT IF EXISTS figures_figure_type_fkey;",
            )
            .await?;
        Ok(())
    }
}
