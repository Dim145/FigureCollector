//! Write tools.
//!
//! Every one of these goes through `crate::services::collection`, the same
//! orchestration the web routes use, so an agent-made change fires the same
//! FX freeze, cache invalidation, activity entry, live event and achievement
//! re-check as a change made in the browser.
//!
//! Three rules hold throughout:
//!
//! * Nothing here consults `is_admin`. `patch_figure` is called with
//!   `as_admin: false` unconditionally, so an administrator's API key can edit
//!   exactly what any other user's key could — the entries they created.
//! * Reversible beats destructive. `archive_owned_item` exists so "I sold it"
//!   doesn't have to mean deletion, and the delete tools' descriptions point
//!   at it.
//! * Destructive tools need an explicit `confirm: true` in the same call, on
//!   top of their own scope.

use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult,
    service::RequestContext, tool, tool_router,
};

use super::ctx;
use super::dto;
use super::server::FcMcp;
use crate::domain::api_key::Scope;
use crate::error::AppResult;
use crate::services::collection;

/// Build a domain input from a tool input, surfacing a parse failure as a
/// tool-level error the model can correct.
macro_rules! parsed {
    ($call:expr, $body:expr) => {
        match $body {
            Ok(v) => v,
            Err(e) => return $call.finish::<()>(Err(e)).await,
        }
    };
}

#[tool_router(router = tool_router_write, vis = "pub")]
impl FcMcp {
    // ------------------------------------------------- owned collection

    #[tool(
        description = "Record a figure the caller now owns, linking it to a catalogue entry. Resolve the figure first (find_figure_by_barcode, then search_catalogue). If the catalogue release date is still in the future, a matching pre-order is created automatically. Amounts are decimal strings with their own ISO-4217 currency; nothing is converted.",
        annotations(
            title = "Add an owned piece",
            read_only_hint = false,
            destructive_hint = false
        )
    )]
    async fn add_owned_item(
        &self,
        Parameters(input): Parameters<dto::AddOwnedItem>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "add_owned_item",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let new = parsed!(call, build_new_owned(&input));
        let created = collection::add_owned_item(&self.state, call.user_id(), new).await;
        call.target(input.figure_id).finish(created).await
    }

    #[tool(
        description = "Edit an owned piece. Omitted fields are left as they are. Both condition grades use the A+/A/A-/B+/B/C/J scale — item and box are graded separately.",
        annotations(
            title = "Edit an owned piece",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn update_owned_item(
        &self,
        Parameters(input): Parameters<dto::UpdateOwnedItem>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "update_owned_item",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let patch = parsed!(call, build_owned_patch(&input));
        let updated =
            collection::patch_owned_item(&self.state, call.user_id(), input.owned_item_id, patch)
                .await;
        call.target(input.owned_item_id).finish(updated).await
    }

    #[tool(
        description = "Archive an owned piece — sold, traded, lost or gifted. The row and its photos are kept, it just leaves the active collection, and restore_owned_item brings it back. This is what 'I got rid of it' should use; delete_owned_item is for a mistaken entry.",
        annotations(
            title = "Archive an owned piece",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn archive_owned_item(
        &self,
        Parameters(input): Parameters<dto::ArchiveOwnedItem>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "archive_owned_item",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let updated = collection::archive_owned_item(
            &self.state,
            call.user_id(),
            input.owned_item_id,
            input.reason.as_deref(),
        )
        .await;
        call.target(input.owned_item_id).finish(updated).await
    }

    #[tool(
        description = "Bring an archived piece back into the active collection.",
        annotations(
            title = "Restore an owned piece",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn restore_owned_item(
        &self,
        Parameters(input): Parameters<dto::OwnedItemId>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "restore_owned_item",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let updated =
            collection::restore_owned_item(&self.state, call.user_id(), input.owned_item_id).await;
        call.target(input.owned_item_id).finish(updated).await
    }

    #[tool(
        description = "Set what an owned piece is worth today, overriding the catalogue-MSRP fallback the collection value uses. Omit the amount to clear the override. This records an opinion about value; it does not sell anything.",
        annotations(
            title = "Set a piece's value",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn set_owned_value(
        &self,
        Parameters(input): Parameters<dto::SetOwnedValue>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "set_owned_value",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let amount = parsed!(call, dto::money(&input.amount));
        let updated = collection::set_owned_value(
            &self.state,
            call.user_id(),
            input.owned_item_id,
            amount,
            input.currency.clone(),
        )
        .await;
        call.target(input.owned_item_id).finish(updated).await
    }

    // --------------------------------------------------------- wishlist

    #[tool(
        description = "Put a catalogue figure on the caller's wishlist, with an optional target price. Idempotent: adding a figure already wished for updates its target price and note. Refused for a figure the caller already owns.",
        annotations(
            title = "Add to the wishlist",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn add_wishlist_item(
        &self,
        Parameters(input): Parameters<dto::AddWishlistItem>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "add_wishlist_item",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let max_price_amount = parsed!(call, dto::money(&input.max_price_amount));
        let new = crate::domain::wishlist::NewWishlistItem {
            figure_id: input.figure_id,
            max_price_amount,
            max_price_currency: input.max_price_currency.clone(),
            note: input.note.clone(),
        };
        let created = collection::add_wishlist_item(&self.state, call.user_id(), new).await;
        call.target(input.figure_id).finish(created).await
    }

    #[tool(
        description = "Change the target price or note on a wishlist entry.",
        annotations(
            title = "Edit a wishlist entry",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn update_wishlist_item(
        &self,
        Parameters(input): Parameters<dto::UpdateWishlistItem>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "update_wishlist_item",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let max_price_amount = parsed!(call, dto::money(&input.max_price_amount));
        let patch = crate::domain::wishlist::WishlistPatch {
            max_price_amount,
            max_price_currency: input.max_price_currency.clone(),
            note: input.note.clone(),
        };
        let updated =
            collection::patch_wishlist_item(&self.state, call.user_id(), input.figure_id, patch)
                .await;
        call.target(input.figure_id).finish(updated).await
    }

    // ------------------------------------------------------- pre-orders

    #[tool(
        description = "Record a pre-order: the figure, the shop, the expected release date, what was paid and any deposit. Use get_preorder_slip_stats first if the question is whether the announced date is realistic.",
        annotations(
            title = "Add a pre-order",
            read_only_hint = false,
            destructive_hint = false
        )
    )]
    async fn add_preorder(
        &self,
        Parameters(input): Parameters<dto::AddPreorder>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "add_preorder",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let new = parsed!(call, build_new_preorder(&input));
        let created = collection::add_preorder(&self.state, call.user_id(), new).await;
        call.target(input.figure_id).finish(created).await
    }

    #[tool(
        description = "Update a pre-order. Moving release_date records a slip in its date history, so pass release_date_note to say why. Setting status to 'received' is what turns a pre-order into a delivered piece for the statistics.",
        annotations(
            title = "Edit a pre-order",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    async fn update_preorder(
        &self,
        Parameters(input): Parameters<dto::UpdatePreorder>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "update_preorder",
            Scope::CollectionWrite,
            &input,
        )
        .await?;
        let patch = parsed!(call, build_preorder_patch(&input));
        let updated =
            collection::patch_preorder(&self.state, call.user_id(), input.preorder_id, patch).await;
        call.target(input.preorder_id).finish(updated).await
    }

    // -------------------------------------------------- shared catalogue

    #[tool(
        description = "Create a catalogue entry. This writes to the catalogue EVERY user of this instance shares, and other people's collections will point at the row — so check find_figure_by_barcode and find_duplicate_figures first, and include the JAN/EAN barcode when you have it. Prefer leaving a field out to guessing it.",
        annotations(
            title = "Create a catalogue entry",
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = true
        )
    )]
    async fn create_figure(
        &self,
        Parameters(input): Parameters<dto::CreateFigure>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "create_figure",
            Scope::CatalogueWrite,
            &input,
        )
        .await?;
        let new = parsed!(call, build_new_figure(&input));
        let created = collection::create_figure(&self.state, call.user_id(), new).await;
        call.finish(created).await
    }

    #[tool(
        description = "Edit a catalogue entry the caller created. Entries created by anyone else are refused, including for an administrator's key — administrative reach is not available through MCP. Omitted fields are left untouched.",
        annotations(
            title = "Edit a catalogue entry",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        )
    )]
    async fn update_figure(
        &self,
        Parameters(input): Parameters<dto::UpdateFigure>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "update_figure",
            Scope::CatalogueWrite,
            &input,
        )
        .await?;
        let patch = parsed!(call, build_figure_patch(&input));
        // `as_admin: false`, always. The web route passes the actor's real
        // role here; this endpoint does not, so an admin's key is bounded by
        // the same ownership rule as anyone else's.
        let updated =
            collection::patch_figure(&self.state, call.user(), false, input.figure_id, patch).await;
        call.target(input.figure_id).finish(updated).await
    }

    // ---------------------------------------------------------- deletes

    #[tool(
        description = "Permanently delete an owned piece, including its photos and 3D scans. There is no undo. archive_owned_item is the right tool for a piece that was sold, traded or lost — use this one only for an entry created by mistake. Requires confirm: true.",
        annotations(
            title = "Delete an owned piece",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true
        )
    )]
    async fn delete_owned_item(
        &self,
        Parameters(input): Parameters<dto::ConfirmedDelete>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "delete_owned_item",
            Scope::CollectionDelete,
            &input,
        )
        .await?;
        if !input.confirm {
            return call
                .refuse(
                    "refused: this permanently deletes the piece, its photos and its 3D scans, \
                     with no undo. Re-run with confirm: true if that is really the intent — or \
                     use archive_owned_item, which is reversible.",
                )
                .await;
        }
        let done = collection::delete_owned_item(&self.state, call.user_id(), input.id).await;
        call.target(input.id)
            .finish(done.map(|()| serde_json::json!({ "deleted": input.id })))
            .await
    }

    #[tool(
        description = "Permanently delete a pre-order and its release-date slip history. No undo. Setting status to 'cancelled' with update_preorder keeps the record instead. Requires confirm: true.",
        annotations(
            title = "Delete a pre-order",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true
        )
    )]
    async fn delete_preorder(
        &self,
        Parameters(input): Parameters<dto::ConfirmedDelete>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "delete_preorder",
            Scope::CollectionDelete,
            &input,
        )
        .await?;
        if !input.confirm {
            return call
                .refuse(
                    "refused: this also destroys the pre-order's date-slip history, which the \
                     slip statistics are computed from. Re-run with confirm: true, or set its \
                     status to 'cancelled' with update_preorder to keep the record.",
                )
                .await;
        }
        let done = collection::delete_preorder(&self.state, call.user_id(), input.id).await;
        call.target(input.id)
            .finish(done.map(|()| serde_json::json!({ "deleted": input.id })))
            .await
    }

    #[tool(
        description = "Take a figure off the caller's wishlist. The cheapest of the deletions to undo — just add it again. `id` is the figure id. Requires confirm: true.",
        annotations(
            title = "Remove from the wishlist",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true
        )
    )]
    async fn remove_wishlist_item(
        &self,
        Parameters(input): Parameters<dto::ConfirmedDelete>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "remove_wishlist_item",
            Scope::CollectionDelete,
            &input,
        )
        .await?;
        if !input.confirm {
            return call
                .refuse(
                    "refused: re-run with confirm: true to remove this figure from the wishlist.",
                )
                .await;
        }
        let done = collection::remove_wishlist_item(&self.state, call.user_id(), input.id).await;
        call.target(input.id)
            .finish(done.map(|()| serde_json::json!({ "removed": input.id })))
            .await
    }
}

// ------------------------------------------------------------- conversions
//
// Free functions rather than `From` impls: they're fallible (money and dates
// arrive as strings) and they belong to this boundary, not to the domain types.

fn build_new_owned(i: &dto::AddOwnedItem) -> AppResult<crate::domain::owned::NewOwnedItem> {
    Ok(crate::domain::owned::NewOwnedItem {
        figure_id: i.figure_id,
        condition: i
            .condition
            .clone()
            .unwrap_or_else(|| "mib_sealed".to_string()),
        price_amount: dto::money(&i.price_amount)?,
        price_currency: i.price_currency.clone(),
        shipping_amount: dto::money(&i.shipping_amount)?,
        store: i.store.clone(),
        purchase_date: dto::date(&i.purchase_date)?,
        location: i.location.clone(),
        notes: i.notes.clone(),
        acquisition_source: i.acquisition_source.clone(),
        acquired_from: i.acquired_from.clone(),
    })
}

fn build_owned_patch(i: &dto::UpdateOwnedItem) -> AppResult<crate::domain::owned::OwnedPatch> {
    Ok(crate::domain::owned::OwnedPatch {
        condition: i.condition.clone(),
        price_amount: dto::money(&i.price_amount)?,
        price_currency: i.price_currency.clone(),
        shipping_amount: dto::money(&i.shipping_amount)?,
        store: i.store.clone(),
        purchase_date: dto::date(&i.purchase_date)?,
        location: i.location.clone(),
        notes: i.notes.clone(),
        acquisition_source: i.acquisition_source.clone(),
        acquired_from: i.acquired_from.clone(),
        condition_item: i.condition_item.clone(),
        condition_box: i.condition_box.clone(),
        completeness: i.completeness.clone(),
        // Trading fields are a marketplace concern, deliberately not part of
        // the MCP surface: offering a piece for sale is a decision with an
        // audience, not a bookkeeping edit.
        for_sale: None,
        for_trade: None,
        asking_price_amount: None,
        asking_price_currency: None,
        sale_note: None,
    })
}

fn build_new_preorder(i: &dto::AddPreorder) -> AppResult<crate::domain::preorder::NewPreorder> {
    Ok(crate::domain::preorder::NewPreorder {
        figure_id: i.figure_id,
        status: i.status.clone().unwrap_or_else(|| "preordered".to_string()),
        store: i.store.clone(),
        order_ref: i.order_ref.clone(),
        tracking_url: i.tracking_url.clone(),
        release_date: dto::date(&i.release_date)?,
        price_amount: dto::money(&i.price_amount)?,
        price_currency: i.price_currency.clone(),
        deposit_amount: dto::money(&i.deposit_amount)?,
        deposit_refund_amount: None,
        balance_paid_at: None,
        estimated_delivery_days: i.estimated_delivery_days,
        notes: i.notes.clone(),
    })
}

fn build_preorder_patch(
    i: &dto::UpdatePreorder,
) -> AppResult<crate::domain::preorder::PreorderPatch> {
    Ok(crate::domain::preorder::PreorderPatch {
        status: i.status.clone(),
        store: i.store.clone(),
        order_ref: i.order_ref.clone(),
        tracking_url: i.tracking_url.clone(),
        release_date: dto::date(&i.release_date)?,
        release_date_note: i.release_date_note.clone(),
        price_amount: dto::money(&i.price_amount)?,
        price_currency: i.price_currency.clone(),
        deposit_amount: dto::money(&i.deposit_amount)?,
        // These two use the domain's `double_option`, where `Some(None)` means
        // "clear it". `None` is the only safe mapping from an absent MCP field
        // — sending `Some(None)` would silently wipe a refund the owner
        // recorded in the browser.
        deposit_refund_amount: None,
        balance_paid_at: None,
        estimated_delivery_days: i.estimated_delivery_days,
        notes: i.notes.clone(),
    })
}

fn build_new_figure(i: &dto::CreateFigure) -> AppResult<crate::domain::figure::NewFigure> {
    Ok(crate::domain::figure::NewFigure {
        name: i.name.clone(),
        manufacturer_name: i.manufacturer_name.clone(),
        sculptor_name: i.sculptor_name.clone(),
        figure_type: i.figure_type.clone(),
        scale: i.scale.clone(),
        height_mm: i.height_mm,
        materials: i.materials.clone().unwrap_or_default(),
        release_date: dto::date(&i.release_date)?,
        msrp_amount: dto::money(&i.msrp_amount)?,
        msrp_currency: i.msrp_currency.clone(),
        jan: i.jan.clone(),
        exclusivity: i.exclusivity.clone(),
        edition: i.edition.clone(),
        version_name: i.version_name.clone(),
        // Not settable from here: an image URL would be fetched and embedded
        // server-side, which makes it an SSRF-shaped input, and there is no
        // store to auto-link an agent-created entry to.
        official_image_url: None,
        description: i.description.clone(),
        series_name: i.series_name.clone(),
        character_name: i.character_name.clone(),
        is_nsfw: i.is_nsfw.unwrap_or(false),
        source_url: None,
        manufacturer_meta: Default::default(),
        series_meta: Default::default(),
        character_meta: Default::default(),
    })
}

fn build_figure_patch(i: &dto::UpdateFigure) -> AppResult<crate::domain::figure::FigurePatch> {
    Ok(crate::domain::figure::FigurePatch {
        name: i.name.clone(),
        manufacturer_name: i.manufacturer_name.clone(),
        sculptor_name: i.sculptor_name.clone(),
        figure_type: i.figure_type.clone(),
        scale: i.scale.clone(),
        height_mm: i.height_mm,
        materials: i.materials.clone(),
        release_date: dto::date(&i.release_date)?,
        msrp_amount: dto::money(&i.msrp_amount)?,
        msrp_currency: i.msrp_currency.clone(),
        jan: i.jan.clone(),
        exclusivity: i.exclusivity.clone(),
        edition: i.edition.clone(),
        version_name: i.version_name.clone(),
        official_image_url: None,
        description: i.description.clone(),
        series_name: i.series_name.clone(),
        character_name: i.character_name.clone(),
        is_nsfw: i.is_nsfw,
        // Appearance tags are the tagger worker's output, not an agent's to
        // rewrite — an edit here would be re-embedded as ground truth.
        visual_tags: None,
        manufacturer_meta: Default::default(),
        series_meta: Default::default(),
        character_meta: Default::default(),
    })
}

/// Guard against a silent widening of the delete surface: these three, and no
/// more, are the tools allowed to destroy a row.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use uuid::Uuid;

    #[test]
    fn only_the_expected_tools_are_marked_destructive() {
        let destructive: Vec<String> = FcMcp::tool_router_write()
            .list_all()
            .into_iter()
            .filter(|t| {
                t.annotations
                    .as_ref()
                    .is_some_and(|a| a.destructive_hint == Some(true))
            })
            .map(|t| t.name.to_string())
            .collect();
        let mut sorted = destructive.clone();
        sorted.sort();
        assert_eq!(
            sorted,
            vec![
                "delete_owned_item",
                "delete_preorder",
                "remove_wishlist_item"
            ],
            "the set of destructive tools changed — is that deliberate?"
        );
    }

    #[test]
    fn money_and_dates_reject_junk_with_an_actionable_message() {
        assert!(dto::money(&Some("1299.00".into())).unwrap().is_some());
        assert!(dto::money(&None).unwrap().is_none());
        let err = dto::money(&Some("about a grand".into())).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(m) if m.contains("decimal strings")));

        // Nothing this endpoint writes is ever meaningfully negative.
        let err = dto::money(&Some("-500".into())).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(m) if m.contains("negative")));
        assert!(
            dto::money(&Some("0".into())).unwrap().is_some(),
            "zero is fine"
        );

        assert!(dto::date(&Some("2026-11-30".into())).unwrap().is_some());
        let err = dto::date(&Some("30/11/2026".into())).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(m) if m.contains("YYYY-MM-DD")));
    }

    #[test]
    fn a_patch_never_clears_a_double_option_field_it_was_not_given() {
        // `deposit_refund_amount` / `balance_paid_at` distinguish absent from
        // explicit null. Mapping an omitted MCP field to `Some(None)` would
        // wipe data the owner entered in the browser.
        let patch = build_preorder_patch(&dto::UpdatePreorder {
            preorder_id: Uuid::nil(),
            status: Some("received".into()),
            store: None,
            order_ref: None,
            tracking_url: None,
            release_date: None,
            release_date_note: None,
            price_amount: None,
            price_currency: None,
            deposit_amount: None,
            estimated_delivery_days: None,
            notes: None,
        })
        .unwrap();
        assert!(patch.deposit_refund_amount.is_none());
        assert!(patch.balance_paid_at.is_none());
    }
}
