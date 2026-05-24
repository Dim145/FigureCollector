use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "photos")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub owned_item_id: Uuid,
    #[sea_orm(unique)]
    pub storage_key: String,
    pub mime: String,
    pub width: i32,
    pub height: i32,
    pub size_bytes: i64,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::owned_items::Entity",
        from = "Column::OwnedItemId",
        to = "super::owned_items::Column::Id",
        on_delete = "Cascade"
    )]
    OwnedItem,
}

impl Related<super::owned_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::OwnedItem.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
