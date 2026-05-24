use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "preorders")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Uuid,
    pub figure_id: Uuid,
    pub status: String,
    pub store: Option<String>,
    pub order_ref: Option<String>,
    pub release_date_original: Option<NaiveDate>,
    pub release_date_current: Option<NaiveDate>,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
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
}

impl ActiveModelBehavior for ActiveModel {}
