//! Cross-device event broadcaster.
//!
//! When a user mutates anything from one device, we want their other open
//! tabs / devices to refresh their cached views immediately. We do this with
//! a per-user `tokio::sync::broadcast` channel: every authenticated WebSocket
//! subscribes to its user's channel, and mutation handlers publish events.
//!
//! Backpressure: if a slow consumer falls more than 64 messages behind we
//! drop them on the floor; the frontend will pick up the state on the next
//! reconnect / refetch.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;
use uuid::Uuid;

const CHANNEL_CAPACITY: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    OwnedItemCreated { owned_id: Uuid, figure_id: Uuid },
    OwnedItemUpdated { owned_id: Uuid },
    OwnedItemDeleted { owned_id: Uuid },
    OwnedItemPhotosChanged { owned_id: Uuid },
    PreorderCreated { preorder_id: Uuid, figure_id: Uuid },
    PreorderUpdated { preorder_id: Uuid },
    PreorderDeleted { preorder_id: Uuid },
    ProfileUpdated,
}

#[derive(Clone, Default)]
pub struct EventBus {
    senders: Arc<RwLock<HashMap<Uuid, broadcast::Sender<Event>>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribe to events for `user_id`, creating the channel on first use.
    pub fn subscribe(&self, user_id: Uuid) -> broadcast::Receiver<Event> {
        let mut senders = self.senders.write().expect("event bus poisoned");
        senders
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }

    /// Publish to `user_id` — silently no-op if no one is subscribed.
    pub fn publish(&self, user_id: Uuid, event: Event) {
        let senders = self.senders.read().expect("event bus poisoned");
        if let Some(tx) = senders.get(&user_id) {
            let _ = tx.send(event);
        }
    }

    /// Periodically called from main.rs to drop channels with no subscribers
    /// so we don't keep a record for every user that has ever signed in.
    pub fn gc(&self) -> usize {
        let mut senders = self.senders.write().expect("event bus poisoned");
        let before = senders.len();
        senders.retain(|_, tx| tx.receiver_count() > 0);
        before - senders.len()
    }
}
