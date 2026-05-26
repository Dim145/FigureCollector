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
    /// Acompte (deposit) paid up-front at preorder time. Stored on the
    /// preorder because it's part of the preorder lifecycle. Treated as
    /// part of `price_amount`, not in addition to it — see the migration
    /// header for the OrzGK-style semantics.
    pub deposit_amount: Option<Decimal>,
    /// What was actually paid back when the preorder is cancelled.
    /// NULL = no decision yet, 0 = lost, partial, or equal to deposit_amount
    /// = fully refunded.
    pub deposit_refund_amount: Option<Decimal>,
    /// Auto-set the first time `status` flips to 'shipped'. Combined with
    /// `estimated_delivery_days` to compute the projected delivery date.
    pub shipped_at: Option<DateTime<Utc>>,
    /// Carrier-provided ETA in days. Combined with `shipped_at` to drive
    /// the J-day countdown chip and the delivery notification cron.
    pub estimated_delivery_days: Option<i32>,
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
