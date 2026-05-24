use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "scans")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub owned_item_id: Uuid,
    pub kind: String,
    pub state: String,
    #[sea_orm(unique)]
    pub storage_prefix: String,
    pub frame_count: i32,
    pub result_key: Option<String>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
