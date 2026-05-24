use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "series")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    #[sea_orm(unique)]
    pub slug: String,
    pub origin: String,
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::characters::Entity")]
    Characters,
}

impl Related<super::characters::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Characters.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
