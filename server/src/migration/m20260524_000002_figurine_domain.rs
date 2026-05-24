use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260524000002_figurine_domain.sql");

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
                r#"
                DROP TABLE IF EXISTS preorder_date_history;
                DROP TABLE IF EXISTS preorders;
                DROP TABLE IF EXISTS wishlist_items;
                DROP TABLE IF EXISTS owned_items;
                DROP TABLE IF EXISTS figure_series;
                DROP TABLE IF EXISTS figure_characters;
                DROP TABLE IF EXISTS figures;
                DROP TABLE IF EXISTS characters;
                DROP TABLE IF EXISTS series;
                DROP TABLE IF EXISTS sculptors;
                DROP TABLE IF EXISTS manufacturers;
                "#,
            )
            .await?;
        Ok(())
    }
}
