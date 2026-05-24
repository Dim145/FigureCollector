use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sea_orm::entity::prelude::*;
use uuid::Uuid;

// NOTE: the `materials TEXT[]` column is intentionally omitted here. Sea-orm's
// derive macro doesn't have a clean `Vec<String>` mapping for Postgres native
// arrays without extra column_type wrangling, and the only consumer of
// `materials` today is `domain::figure` which still talks to PG via raw sqlx.
// If sea-orm queries ever need to surface materials, we can add a custom
// column type or split the table into a 1:N child.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "figures")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    #[sea_orm(unique)]
    pub slug: String,
    pub manufacturer_id: Option<Uuid>,
    pub sculptor_id: Option<Uuid>,
    pub figure_type: String,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub release_date: Option<NaiveDate>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    pub jan: Option<String>,
    pub exclusivity: Option<String>,
    pub edition: Option<String>,
    pub version_name: Option<String>,
    pub official_image_url: Option<String>,
    pub description: Option<String>,
    pub mfc_id: Option<i32>,
    pub created_by: Option<Uuid>,
    pub is_user_submitted: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::manufacturers::Entity",
        from = "Column::ManufacturerId",
        to = "super::manufacturers::Column::Id",
        on_delete = "SetNull"
    )]
    Manufacturer,
    #[sea_orm(
        belongs_to = "super::sculptors::Entity",
        from = "Column::SculptorId",
        to = "super::sculptors::Column::Id",
        on_delete = "SetNull"
    )]
    Sculptor,
}

impl ActiveModelBehavior for ActiveModel {}
