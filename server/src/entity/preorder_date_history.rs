use chrono::{DateTime, NaiveDate, Utc};
use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "preorder_date_history")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub preorder_id: Uuid,
    pub previous_date: Option<NaiveDate>,
    pub new_date: Option<NaiveDate>,
    pub source: String,
    pub note: Option<String>,
    pub noted_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::preorders::Entity",
        from = "Column::PreorderId",
        to = "super::preorders::Column::Id",
        on_delete = "Cascade"
    )]
    Preorder,
}

impl ActiveModelBehavior for ActiveModel {}
