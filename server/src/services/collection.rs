//! Collection write orchestration — the effects that must accompany a
//! collection change, wherever the change comes from.
//!
//! Writing an owned item is not one INSERT. It also freezes the purchase-time
//! FX rate, invalidates the user's cached stats, records an activity event,
//! publishes a live event to open SPA tabs, auto-creates a pre-order when the
//! piece isn't out yet, and re-evaluates achievements (which can fan out to
//! external notification channels).
//!
//! That sequence used to live inline in `routes::owned` / `routes::preorders`.
//! It moved here when the MCP endpoint (`routes::mcp`) became a second way in:
//! two copies of it would have drifted, and the drift would be silent — an
//! agent-added piece that never appears in the activity feed, or a stats page
//! that stays stale until something else invalidates it.
//!
//! Every function is scoped by `user_id`; none of them consults `is_admin`.
//! Authorization is the caller's job — except on `patch_figure`, where the
//! ownership rule is part of the operation and is therefore enforced here.

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::auth::user::User;
use crate::domain::figure::{FigurePatch, NewFigure};
use crate::domain::owned::{NewOwnedItem, OwnedPatch};
use crate::domain::preorder::{NewPreorder, PreorderPatch};
use crate::domain::wishlist::{NewWishlistItem, WishlistPatch};
use crate::domain::{achievement, activity, figure, owned, preorder, visual_search, wishlist};
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::state::AppState;

// ------------------------------------------------------------ owned items

/// Add a piece to the collection, with everything that must follow it.
pub async fn add_owned_item(
    state: &AppState,
    user_id: Uuid,
    input: NewOwnedItem,
) -> AppResult<owned::OwnedItem> {
    // Freeze the cost→EUR rate at save time when a real price is recorded, so
    // the collection's plus-value doesn't drift with the market rate later.
    let price_fx_rate = match (&input.price_amount, input.price_currency.as_deref()) {
        (Some(_), Some(cur)) => {
            crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await
        }
        _ => None,
    };
    let item = owned::create(&state.pool, user_id, input, price_fx_rate).await?;
    state.cache.invalidate_user_collection(user_id).await;

    // Activity log: snapshot the figure so renames/deletes don't break the feed.
    let mut snap = activity::figure_snapshot(&state.pool, item.figure_id).await;
    if let Some(obj) = snap.as_object_mut() {
        obj.insert(
            "condition".into(),
            serde_json::Value::String(item.condition.clone()),
        );
        obj.insert(
            "owned_id".into(),
            serde_json::Value::String(item.id.to_string()),
        );
    }
    activity::record(&state.pool, user_id, "owned_added", snap).await;

    state.events.publish(
        user_id,
        Event::OwnedItemCreated {
            owned_id: item.id,
            figure_id: item.figure_id,
        },
    );
    tracing::info!(user_id = %user_id, figure_id = %item.figure_id, "owned_item added");

    // Auto-link a preorder row when the figurine isn't out yet. Looks up the
    // catalog release_date directly to avoid trusting client-supplied input.
    let release: Option<(Option<chrono::NaiveDate>,)> =
        sqlx::query_as("SELECT release_date FROM figures WHERE id = $1")
            .bind(item.figure_id)
            .fetch_optional(&state.pool)
            .await?;
    if let Some((Some(date),)) = release {
        if date > chrono::Utc::now().date_naive() {
            match preorder::create_for_owned_item(
                &state.pool,
                user_id,
                item.id,
                item.figure_id,
                date,
            )
            .await
            {
                Ok(po) => {
                    tracing::info!(
                        preorder_id = %po.id, owned_id = %item.id, release = %date,
                        "auto-preorder created"
                    );
                    state.events.publish(
                        user_id,
                        Event::PreorderCreated {
                            preorder_id: po.id,
                            figure_id: item.figure_id,
                        },
                    );
                }
                Err(e) => {
                    tracing::warn!(error = ?e, owned_id = %item.id, "auto-preorder failed");
                }
            }
        }
    }

    grant_achievements(state, user_id, Some(item.figure_id)).await;
    Ok(item)
}

pub async fn patch_owned_item(
    state: &AppState,
    user_id: Uuid,
    id: Uuid,
    input: OwnedPatch,
) -> AppResult<owned::OwnedItem> {
    // Compute a fresh frozen rate for the patch's currency; the UPDATE only
    // adopts it when the currency actually changes (or was never captured), so
    // editing other fields never clobbers the purchase-time rate.
    let price_fx_rate = match input.price_currency.as_deref() {
        Some(cur) => crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await,
        None => None,
    };
    let updated = owned::patch(&state.pool, user_id, id, input, price_fx_rate).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(updated)
}

pub async fn archive_owned_item(
    state: &AppState,
    user_id: Uuid,
    id: Uuid,
    reason: Option<&str>,
) -> AppResult<owned::OwnedItem> {
    let updated = owned::archive(&state.pool, user_id, id, reason).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(updated)
}

pub async fn restore_owned_item(
    state: &AppState,
    user_id: Uuid,
    id: Uuid,
) -> AppResult<owned::OwnedItem> {
    let updated = owned::restore(&state.pool, user_id, id).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(updated)
}

pub async fn set_owned_value(
    state: &AppState,
    user_id: Uuid,
    id: Uuid,
    amount: Option<Decimal>,
    currency: Option<String>,
) -> AppResult<owned::OwnedItem> {
    let updated = owned::set_value(&state.pool, user_id, id, amount, currency).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(updated)
}

/// Remove a piece for good, including its photo and scan blobs.
///
/// Irreversible: the photo/scan rows cascade away and their objects are purged
/// from storage. `archive_owned_item` is the reversible alternative and is what
/// a "sold it" or "traded it" actually wants.
pub async fn delete_owned_item(state: &AppState, user_id: Uuid, id: Uuid) -> AppResult<()> {
    // Snapshot before deletion so the activity payload still has context.
    let snapshot: Option<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT o.figure_id, f.name, m.name
         FROM owned_items o
         JOIN figures f         ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.id = $1 AND o.user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let orphaned = owned::delete_for_user(&state.pool, user_id, id).await?;
    state.cache.invalidate_user_collection(user_id).await;

    // Best-effort purge of the now-orphaned Garage blobs (the photo/scan rows
    // already cascaded away). Failures are logged inside the storage layer; a
    // missing key is a no-op on Garage.
    for key in &orphaned.photo_keys {
        if let Err(e) = state.storage.delete(key).await {
            tracing::warn!(error = ?e, storage_key = %key, "orphan photo blob delete failed after owned-item delete");
        }
    }
    for (prefix, result_key) in &orphaned.scan_blobs {
        crate::services::scan_cleanup::purge_scan_blobs(state, prefix, result_key.as_deref()).await;
    }

    if let Some((figure_id, figure_name, manufacturer_name)) = snapshot {
        activity::record(
            &state.pool,
            user_id,
            "owned_removed",
            serde_json::json!({
                "owned_id": id,
                "figure_id": figure_id,
                "figure_name": figure_name,
                "manufacturer_name": manufacturer_name,
            }),
        )
        .await;
    }

    state
        .events
        .publish(user_id, Event::OwnedItemDeleted { owned_id: id });
    Ok(())
}

// --------------------------------------------------------------- wishlist

pub async fn add_wishlist_item(
    state: &AppState,
    user_id: Uuid,
    input: NewWishlistItem,
) -> AppResult<wishlist::WishlistItem> {
    let item = wishlist::add(&state.pool, user_id, input).await?;
    state.cache.invalidate_user_collection(user_id).await;
    Ok(item)
}

pub async fn patch_wishlist_item(
    state: &AppState,
    user_id: Uuid,
    figure_id: Uuid,
    input: WishlistPatch,
) -> AppResult<wishlist::WishlistItem> {
    let item = wishlist::patch(&state.pool, user_id, figure_id, input).await?;
    state.cache.invalidate_user_collection(user_id).await;
    Ok(item)
}

pub async fn remove_wishlist_item(
    state: &AppState,
    user_id: Uuid,
    figure_id: Uuid,
) -> AppResult<()> {
    wishlist::remove(&state.pool, user_id, figure_id).await?;
    state.cache.invalidate_user_collection(user_id).await;
    Ok(())
}

// ------------------------------------------------------------- pre-orders

pub async fn add_preorder(
    state: &AppState,
    user_id: Uuid,
    input: NewPreorder,
) -> AppResult<preorder::Preorder> {
    // Freeze the cost→EUR rate at save time when a real price is recorded
    // (covers price + deposit + refund, which share price_currency).
    let price_fx_rate = match (&input.price_amount, input.price_currency.as_deref()) {
        (Some(_), Some(cur)) => {
            crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await
        }
        _ => None,
    };
    let po = preorder::create(&state.pool, user_id, input, price_fx_rate).await?;

    let mut snap = activity::figure_snapshot(&state.pool, po.figure_id).await;
    if let Some(obj) = snap.as_object_mut() {
        obj.insert(
            "preorder_id".into(),
            serde_json::Value::String(po.id.to_string()),
        );
        obj.insert(
            "status".into(),
            serde_json::Value::String(po.status.clone()),
        );
        if let Some(d) = po.release_date_current {
            obj.insert(
                "release_date".into(),
                serde_json::Value::String(d.to_string()),
            );
        }
        // `po.store` used to be the free-text store name; now it's
        // `store_id` (UUID, less useful in activity snapshots). The
        // store name can be recovered by following the preorder_id
        // link, so we skip embedding it here.
    }
    activity::record(&state.pool, user_id, "preorder_created", snap).await;
    state.cache.invalidate_user_collection(user_id).await;

    state.events.publish(
        user_id,
        Event::PreorderCreated {
            preorder_id: po.id,
            figure_id: po.figure_id,
        },
    );

    grant_achievements(state, user_id, Some(po.figure_id)).await;
    Ok(po)
}

pub async fn patch_preorder(
    state: &AppState,
    user_id: Uuid,
    id: Uuid,
    input: PreorderPatch,
) -> AppResult<preorder::Preorder> {
    // Capture the pre-patch state so we can emit accurate activity events.
    let before: Option<(Uuid, String, Option<chrono::NaiveDate>)> = sqlx::query_as(
        "SELECT figure_id, status, release_date_current FROM preorders WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    // Re-freeze the cost rate for the patch's currency; the UPDATE only adopts
    // it on a real currency change (or first capture).
    let price_fx_rate = match input.price_currency.as_deref() {
        Some(cur) => crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await,
        None => None,
    };
    let updated = preorder::patch(&state.pool, user_id, id, input, price_fx_rate).await?;
    state.cache.invalidate_user_collection(user_id).await;

    if let Some((figure_id, prev_status, prev_date)) = before {
        let mut snap = activity::figure_snapshot(&state.pool, figure_id).await;
        if let Some(obj) = snap.as_object_mut() {
            obj.insert(
                "preorder_id".into(),
                serde_json::Value::String(id.to_string()),
            );
        }

        // Status change
        if prev_status != updated.status {
            let mut s = snap.clone();
            if let Some(obj) = s.as_object_mut() {
                obj.insert("from_status".into(), serde_json::Value::String(prev_status));
                obj.insert(
                    "to_status".into(),
                    serde_json::Value::String(updated.status.clone()),
                );
            }
            let kind = if updated.status == "received" {
                "preorder_received"
            } else {
                "preorder_status_changed"
            };
            activity::record(&state.pool, user_id, kind, s).await;
        }

        // Release-date slip
        if prev_date != updated.release_date_current {
            let mut s = snap.clone();
            if let Some(obj) = s.as_object_mut() {
                if let Some(d) = prev_date {
                    obj.insert("from_date".into(), serde_json::Value::String(d.to_string()));
                }
                if let Some(d) = updated.release_date_current {
                    obj.insert("to_date".into(), serde_json::Value::String(d.to_string()));
                }
            }
            activity::record(&state.pool, user_id, "preorder_slipped", s).await;
        }
    }

    state
        .events
        .publish(user_id, Event::PreorderUpdated { preorder_id: id });

    // Status changes can flip "preorders_received" — re-evaluate.
    // The patched preorder's figure is the natural trigger.
    grant_achievements(state, user_id, Some(updated.figure_id)).await;
    Ok(updated)
}

pub async fn delete_preorder(state: &AppState, user_id: Uuid, id: Uuid) -> AppResult<()> {
    preorder::delete_for_user(&state.pool, user_id, id).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::PreorderDeleted { preorder_id: id });
    Ok(())
}

// ------------------------------------------------------- shared catalogue

/// Add an entry to the catalogue **every user shares**.
pub async fn create_figure(
    state: &AppState,
    user_id: Uuid,
    input: NewFigure,
) -> AppResult<figure::Figure> {
    let figure = figure::create(&state.pool, user_id, input).await?;
    tracing::info!(figure_id = %figure.id, created_by = %user_id, "figure created");
    // Keep the visual-search index current: queue this figure's images (its
    // official image now; any photos as they're uploaded). Best-effort + gated.
    visual_search::enqueue_figure_if_enabled(&state.pool, figure.id).await;
    Ok(figure)
}

/// Edit a shared catalogue entry.
///
/// `as_admin` decides whether the actor may edit an entry they did not create.
/// The web route passes the actor's real `is_admin`; the MCP endpoint passes
/// `false` unconditionally — administrative reach is out of scope there by
/// design, and an admin's API key must not quietly carry it. Keeping the
/// decision a parameter makes that choice visible at both call sites instead of
/// hiding it behind a role lookup in here.
pub async fn patch_figure(
    state: &AppState,
    actor: &User,
    as_admin: bool,
    id: Uuid,
    input: FigurePatch,
) -> AppResult<figure::Figure> {
    let existing = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let owner = existing.created_by == Some(actor.id);
    if !as_admin && !owner {
        return Err(AppError::Forbidden);
    }
    let updated = figure::patch(&state.pool, id, input).await?;
    tracing::info!(
        figure_id = %updated.id,
        by_user = %actor.id,
        as_admin = as_admin && !owner,
        "figure updated",
    );
    // If the official image URL changed, forget the OLD one's index + queue entry
    // (image_ref is the URL itself — no FK to cascade), then enqueue the new one.
    // Otherwise a stale embedding for the replaced URL would linger.
    if let Some(old) = existing.official_image_url.as_deref() {
        if !old.is_empty() && updated.official_image_url.as_deref() != Some(old) {
            visual_search::forget_image(&state.pool, old).await;
        }
    }
    // A by-hand appearance-tags edit → re-embed the figure's tagvec so the
    // "Description" search reflects it (gated; the auto-tagger won't overwrite it).
    if updated.visual_tags != existing.visual_tags {
        visual_search::requeue_tagvec_if_enabled(&state.pool, updated.id).await;
    }
    visual_search::enqueue_figure_if_enabled(&state.pool, updated.id).await;
    Ok(updated)
}

// ---------------------------------------------------------------- helpers

/// Re-evaluate the achievement rules and fan any new unlocks out to the user's
/// notification channels. Best-effort: a failure here must never fail the
/// write that triggered it.
async fn grant_achievements(state: &AppState, user_id: Uuid, figure_id: Option<Uuid>) {
    if let Ok(newly) =
        achievement::check_and_grant(&state.db, &state.pool, user_id, figure_id).await
    {
        if !newly.is_empty() {
            state.events.publish(
                user_id,
                Event::AchievementsUnlocked {
                    codes: newly.iter().map(|a| a.code.clone()).collect(),
                },
            );
            crate::services::notify::dispatch_achievements(state, user_id, &newly).await;
        }
    }
}
