use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::Serialize;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize)]
#[sea_orm(table_name = "user_achievements")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub achievement_code: String,
    pub unlocked_at: DateTime<Utc>,
    /// The figurine that pushed the user over the threshold, when known.
    /// Drives the photo shown on the seal in the redesigned achievements page.
    pub trigger_figure_id: Option<Uuid>,
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
        belongs_to = "super::achievements::Entity",
        from = "Column::AchievementCode",
        to = "super::achievements::Column::Code",
        on_delete = "Cascade"
    )]
    Achievement,
}

impl Related<super::achievements::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Achievement.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
