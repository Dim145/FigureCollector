use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub username: String,
    pub email: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub locale: String,
    pub is_admin: bool,
    pub public_profile_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::oauth_identities::Entity")]
    OauthIdentities,
    #[sea_orm(has_one = "super::local_credentials::Entity")]
    LocalCredentials,
    #[sea_orm(has_many = "super::owned_items::Entity")]
    OwnedItems,
    #[sea_orm(has_many = "super::preorders::Entity")]
    Preorders,
    #[sea_orm(has_many = "super::activity_events::Entity")]
    ActivityEvents,
}

impl Related<super::oauth_identities::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::OauthIdentities.def()
    }
}

impl Related<super::local_credentials::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::LocalCredentials.def()
    }
}

impl Related<super::owned_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::OwnedItems.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
