use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "owned_items")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Uuid,
    pub figure_id: Uuid,
    pub condition: String,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub store: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id",
        on_delete = "Cascade"
    )]
    User,
    #[sea_orm(
        belongs_to = "super::figures::Entity",
        from = "Column::FigureId",
        to = "super::figures::Column::Id",
        on_delete = "Restrict"
    )]
    Figure,
    #[sea_orm(has_many = "super::photos::Entity")]
    Photos,
    #[sea_orm(has_many = "super::scans::Entity")]
    Scans,
}

impl Related<super::figures::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Figure.def()
    }
}

impl Related<super::photos::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Photos.def()
    }
}

impl Related<super::scans::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Scans.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
