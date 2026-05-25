use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260524000017_notifications.sql");

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
                "DROP TABLE IF EXISTS notification_dedup;
                 DROP TABLE IF EXISTS web_push_subscriptions;
                 DROP TABLE IF EXISTS notifications;
                 DROP TABLE IF EXISTS user_notification_routes;
                 DROP TABLE IF EXISTS user_notification_channels;
                 DROP TABLE IF EXISTS notification_channels;",
            )
            .await?;
        Ok(())
    }
}
