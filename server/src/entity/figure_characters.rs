use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "figure_characters")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub figure_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub character_id: Uuid,
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
        belongs_to = "super::characters::Entity",
        from = "Column::CharacterId",
        to = "super::characters::Column::Id",
        on_delete = "Cascade"
    )]
    Character,
}

impl ActiveModelBehavior for ActiveModel {}
