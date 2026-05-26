use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SQL_UP: &str = include_str!("../../migrations/20260526000005_stores.sql");

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
                "ALTER TABLE owned_items ADD COLUMN IF NOT EXISTS store TEXT;
                 ALTER TABLE preorders   ADD COLUMN IF NOT EXISTS store TEXT;
                 UPDATE owned_items o SET store = s.name FROM stores s WHERE o.store_id = s.id;
                 UPDATE preorders   p SET store = s.name FROM stores s WHERE p.store_id = s.id;
                 DROP INDEX IF EXISTS owned_items_store_idx;
                 DROP INDEX IF EXISTS preorders_store_idx;
                 ALTER TABLE owned_items DROP COLUMN IF EXISTS store_id;
                 ALTER TABLE preorders   DROP COLUMN IF EXISTS store_id;
                 DROP FUNCTION IF EXISTS slugify_store(TEXT);
                 DROP TRIGGER IF EXISTS stores_touch ON stores;
                 DROP FUNCTION IF EXISTS stores_touch_updated_at();
                 DROP TABLE IF EXISTS stores;",
            )
            .await?;
        Ok(())
    }
}
