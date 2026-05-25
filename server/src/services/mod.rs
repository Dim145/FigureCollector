//! Cross-cutting services that compose multiple domain modules.
//!
//! The notification dispatcher is the canonical example: an achievement
//! grant in the achievements domain triggers a notification row in the
//! notifications domain plus external channel fan-out. Putting that
//! orchestration here keeps both domains self-contained.

pub mod notify;
pub mod release_cron;
