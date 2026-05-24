use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize)]
#[sea_orm(table_name = "achievements")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub code: String,
    pub category: String,
    pub tier: String,
    pub kind: String,
    pub threshold: i32,
    pub sort_order: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::user_achievements::Entity")]
    UserAchievements,
}

impl Related<super::user_achievements::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserAchievements.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
