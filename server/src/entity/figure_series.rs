use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "figure_series")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub figure_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub series_id: Uuid,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::figures::Entity",
        from = "Column::FigureId",
        to = "super::figures::Column::Id",
        on_delete = "Cascade"
    )]
    Figure,
    #[sea_orm(
        belongs_to = "super::series::Entity",
        from = "Column::SeriesId",
        to = "super::series::Column::Id",
        on_delete = "Cascade"
    )]
    Series,
}

impl ActiveModelBehavior for ActiveModel {}
