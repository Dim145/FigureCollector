use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260524000001_initial_schema.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(SQL_UP).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse order: drop dependents first.
        manager
            .get_connection()
            .execute_unprepared(
                r#"
                DROP TRIGGER  IF EXISTS local_credentials_updated_at ON local_credentials;
                DROP TRIGGER  IF EXISTS users_updated_at             ON users;
                DROP TABLE    IF EXISTS local_credentials;
                DROP TABLE    IF EXISTS oauth_identities;
                DROP TABLE    IF EXISTS users;
                DROP FUNCTION IF EXISTS set_updated_at();
                "#,
            )
            .await?;
        Ok(())
    }
}
