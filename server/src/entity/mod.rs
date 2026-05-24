//! Sea-ORM entity definitions, one module per table.
//!
//! These mirror the schema declared in `server/migrations/*.sql` exactly.
//! Relations between entities (`#[sea_orm(has_many = "…")]`) are only declared
//! when the application layer actually navigates them — adding more later is
//! purely additive.
//!
//! Modules that have been migrated off raw sqlx already use these entities;
//! the rest still query through `state.pool`. Both paths share the same
//! underlying connection (sea-orm wraps the sqlx PgPool).

pub mod activity_events;
pub mod characters;
pub mod external_lookups;
pub mod figure_characters;
pub mod figure_series;
pub mod figures;
pub mod local_credentials;
pub mod manufacturers;
pub mod oauth_identities;
pub mod owned_items;
pub mod photos;
pub mod preorder_date_history;
pub mod preorders;
pub mod scans;
pub mod sculptors;
pub mod series;
pub mod users;
pub mod wishlist_items;
