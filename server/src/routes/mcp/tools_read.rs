//! Read-only tools: the shared catalogue, the caller's collection, and their
//! statistics.
//!
//! Each one is a thin wrapper: authorize → call a `crate::domain` function with
//! the caller's own `user_id` → hand the result to `Call::finish`. No SQL, and
//! no re-derived business rules.

use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult,
    service::RequestContext, tool, tool_router,
};

use super::ctx;
use super::dto::{self, Page};
use super::server::FcMcp;
use crate::domain::api_key::Scope;
use crate::error::AppError;

#[tool_router(router = tool_router_read, vis = "pub")]
impl FcMcp {
    // ---------------------------------------------------------- catalogue

    #[tool(
        description = "Search the shared figure catalogue by name fragment, figure type, manufacturer or appearance tag. Returns a page of catalogue entries with total count. This is the catalogue every user shares, not the caller's own collection.",
        annotations(
            title = "Search the catalogue",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn search_catalogue(
        &self,
        Parameters(input): Parameters<dto::SearchCatalogue>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "search_catalogue",
            Scope::CatalogueRead,
            &input,
        )
        .await?;

        let limit = dto::clamp_limit(input.limit);
        let mut query = crate::domain::figure::ListQuery {
            q: input.q,
            figure_type: input.figure_type,
            manufacturer: input.manufacturer,
            tag: input.tag,
            limit: Some(limit),
            offset: Some(dto::clamp_offset(input.offset)),
            ..Default::default()
        };
        // Never taken from the caller: the domain marks this field
        // `skip_deserializing` precisely so a client cannot opt out of the
        // account holder's own NSFW preference.
        query.exclude_nsfw = call.hide_nsfw();

        let figures = crate::domain::figure::list(&self.state.pool, query).await;
        call.finish(figures).await
    }

    #[tool(
        description = "Fetch one catalogue entry in full by its id: name, maker, sculptor, scale, height, materials, release date, MSRP, barcode, edition and description.",
        annotations(
            title = "Figure details",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_figure(
        &self,
        Parameters(input): Parameters<dto::FigureId>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_figure",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        let found = crate::domain::figure::find_by_id(&self.state.pool, input.figure_id).await;
        // An NSFW-hiding account must not learn a piece exists by id either.
        let result = match found {
            Ok(Some(f)) if f.is_nsfw && call.hide_nsfw() => Err(AppError::NotFound),
            Ok(Some(f)) => Ok(f),
            Ok(None) => Err(AppError::NotFound),
            Err(e) => Err(e),
        };
        call.target(input.figure_id).finish(result).await
    }

    #[tool(
        description = "Look up a catalogue entry by its JAN/EAN barcode — an exact match is proof of identity. Use this before creating anything: the barcode is the one field that reliably says 'this figure already exists'.",
        annotations(
            title = "Find by barcode",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn find_figure_by_barcode(
        &self,
        Parameters(input): Parameters<dto::Barcode>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "find_figure_by_barcode",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        let found =
            crate::domain::figure::find_by_jan(&self.state.pool, &input.jan, call.hide_nsfw())
                .await;
        call.finish(found).await
    }

    #[tool(
        description = "Find catalogue entries that look like duplicates of a candidate name (and barcode, if known). Run this before create_figure so you don't add a second row for a figure other people already own.",
        annotations(
            title = "Duplicate check",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn find_duplicate_figures(
        &self,
        Parameters(input): Parameters<dto::DuplicateProbe>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "find_duplicate_figures",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        let found = crate::domain::figure::find_duplicates(
            &self.state.pool,
            &input.name,
            input.jan.as_deref(),
            call.hide_nsfw(),
        )
        .await;
        call.finish(found).await
    }

    #[tool(
        description = "Resolve up to 60 figure names to their best catalogue matches in one call, each scored. Use it to reconcile a list (a spreadsheet, an order confirmation, a photo caption) against the catalogue before doing anything with it.",
        annotations(
            title = "Bulk name matching",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn match_figures(
        &self,
        Parameters(input): Parameters<dto::MatchFigures>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "match_figures",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        // Same ceiling the HTTP route enforces — the query fans out per name.
        if input.queries.len() > 60 {
            return call.refuse("at most 60 queries per call").await;
        }
        let hide_nsfw = call.hide_nsfw();
        let mut out = Vec::with_capacity(input.queries.len());
        for q in &input.queries {
            match crate::domain::figure::match_one(
                &self.state.pool,
                &q.name,
                q.manufacturer.as_deref(),
                hide_nsfw,
            )
            .await
            {
                Ok(matches) => out.push(serde_json::json!({
                    "query": q.name,
                    "matches": matches,
                })),
                Err(e) => return call.finish::<()>(Err(e)).await,
            }
        }
        call.finish(Ok(out)).await
    }

    #[tool(
        description = "The catalogue's shape: available figure types, and the facet counts (manufacturers, series, scales, materials) that make useful search filters.",
        annotations(
            title = "Catalogue facets",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn list_catalogue_facets(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "list_catalogue_facets",
            Scope::CatalogueRead,
            &(),
        )
        .await?;
        let facets = crate::domain::catalogue::facets(&self.state.pool, call.hide_nsfw()).await;
        let types = crate::domain::figure_type::list(&self.state.pool).await;
        let result = match (facets, types) {
            (Ok(facets), Ok(types)) => Ok(serde_json::json!({
                "facets": facets,
                "figure_types": types,
            })),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        call.finish(result).await
    }

    #[tool(
        description = "List the catalogue's manufacturers, series, characters, sculptors or materials, with slugs to feed browse_entity and search_catalogue.",
        annotations(
            title = "Catalogue entities",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn list_catalogue_entities(
        &self,
        Parameters(input): Parameters<dto::ListEntities>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        use crate::domain::entity;
        use dto::EntityKind;

        let call = ctx::authorize(
            &self.state,
            &ctx,
            "list_catalogue_entities",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        // Each lookup has its own row type, so finish inside the arm rather
        // than forcing them all through `serde_json::Value` first.
        let pool = &self.state.pool;
        match input.kind {
            EntityKind::Manufacturer => {
                call.finish(entity::list_manufacturers_lookup(pool).await)
                    .await
            }
            EntityKind::Series => call.finish(entity::list_series_lookup(pool).await).await,
            EntityKind::Character => {
                call.finish(entity::list_characters_lookup(pool).await)
                    .await
            }
            EntityKind::Sculptor => call.finish(entity::list_sculptors_lookup(pool).await).await,
            EntityKind::Material => call.finish(entity::list_materials_lookup(pool).await).await,
        }
    }

    #[tool(
        description = "Open a manufacturer, series or character page: the entity itself plus every catalogue figure attached to it. Sculptors and materials have no page — filter search_catalogue instead.",
        annotations(
            title = "Browse an entity",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn browse_entity(
        &self,
        Parameters(input): Parameters<dto::BrowseEntity>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        use crate::domain::entity;
        use dto::EntityKind;

        let call = ctx::authorize(
            &self.state,
            &ctx,
            "browse_entity",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        let pool = &self.state.pool;
        let hide = call.hide_nsfw();
        let result = match input.kind {
            EntityKind::Manufacturer => {
                match entity::find_manufacturer_by_slug(pool, &input.slug).await {
                    Ok(Some(e)) => entity::figures_for_manufacturer(pool, e.id, hide)
                        .await
                        .map(|figures| serde_json::json!({ "entity": e, "figures": figures })),
                    Ok(None) => Err(AppError::NotFound),
                    Err(e) => Err(e),
                }
            }
            EntityKind::Series => match entity::find_series_by_slug(pool, &input.slug).await {
                Ok(Some(e)) => entity::figures_for_series(pool, e.id, hide)
                    .await
                    .map(|figures| serde_json::json!({ "entity": e, "figures": figures })),
                Ok(None) => Err(AppError::NotFound),
                Err(e) => Err(e),
            },
            EntityKind::Character => {
                match entity::find_character_by_slug(pool, &input.slug).await {
                    Ok(Some(e)) => entity::figures_for_character(pool, e.id, hide)
                        .await
                        .map(|figures| serde_json::json!({ "entity": e, "figures": figures })),
                    Ok(None) => Err(AppError::NotFound),
                    Err(e) => Err(e),
                }
            }
            EntityKind::Sculptor | EntityKind::Material => Err(AppError::BadRequest(
                "sculptors and materials have no entity page; filter search_catalogue instead",
            )),
        };
        call.finish(result).await
    }

    #[tool(
        description = "Observed market-price history for one catalogue figure, oldest first — what shops have been asking over time, not what the caller paid.",
        annotations(
            title = "Figure price history",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_figure_price_history(
        &self,
        Parameters(input): Parameters<dto::FigureId>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_figure_price_history",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        let history =
            crate::domain::figure_price::history_for_figure(&self.state.pool, input.figure_id)
                .await;
        call.target(input.figure_id).finish(history).await
    }

    #[tool(
        description = "Estimate import duty, VAT and carrier handling for a purchase, using the rules an admin configured for this instance. Pure arithmetic — nothing is bought, recorded or sent anywhere. No estimate is returned for an unknown destination rather than a guessed one.",
        annotations(
            title = "Landed-cost estimate",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn estimate_landed_cost(
        &self,
        Parameters(input): Parameters<dto::LandedCost>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "estimate_landed_cost",
            Scope::CatalogueRead,
            &input,
        )
        .await?;
        let quote = crate::domain::landed_cost::Quote {
            goods: input.goods,
            shipping: input.shipping.unwrap_or(0.0),
            currency: input.currency.clone(),
            destination: input.destination.clone(),
            carrier: input.carrier.clone(),
            items: input.items.unwrap_or(1),
        };
        let result = crate::domain::landed_cost::rules(&self.state.pool)
            .await
            .map(|rules| {
                serde_json::json!({
                    "estimate": crate::domain::landed_cost::estimate(&rules, &quote),
                    "destinations": rules.destinations.keys().collect::<Vec<_>>(),
                    "carriers": rules.carriers.keys().collect::<Vec<_>>(),
                })
            });
        call.finish(result).await
    }

    // --------------------------------------------------------- collection

    #[tool(
        description = "The caller's owned pieces, newest first: condition, two-axis grades, purchase price and shipping (each with its own currency), current value, storage location and notes. Archived pieces (sold, traded, lost) are excluded unless asked for.",
        annotations(title = "Owned pieces", read_only_hint = true, idempotent_hint = true)
    )]
    async fn list_owned_items(
        &self,
        Parameters(input): Parameters<dto::ListOwned>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "list_owned_items",
            Scope::CollectionRead,
            &input,
        )
        .await?;
        let items = crate::domain::owned::list_for_user(
            &self.state.pool,
            call.user_id(),
            call.hide_nsfw(),
            input.include_archived.unwrap_or(false),
            input.tag.as_deref(),
        )
        .await;
        // The domain returns the whole collection; page it here so one call
        // can't dump hundreds of rows.
        let paged = items.map(|all| {
            Page::of(
                all,
                dto::clamp_limit(input.limit),
                dto::clamp_offset(input.offset),
            )
        });
        call.finish(paged).await
    }

    #[tool(
        description = "One owned piece in full, by its id.",
        annotations(title = "Owned piece", read_only_hint = true, idempotent_hint = true)
    )]
    async fn get_owned_item(
        &self,
        Parameters(input): Parameters<dto::OwnedItemId>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_owned_item",
            Scope::CollectionRead,
            &input,
        )
        .await?;
        // Read through the user-scoped list rather than by id alone: the
        // scoping is then structural, not something this tool has to remember.
        let found = crate::domain::owned::list_for_user(
            &self.state.pool,
            call.user_id(),
            call.hide_nsfw(),
            true,
            None,
        )
        .await
        .and_then(|items| {
            items
                .into_iter()
                .find(|i| i.id == input.owned_item_id)
                .ok_or(AppError::NotFound)
        });
        call.target(input.owned_item_id).finish(found).await
    }

    #[tool(
        description = "The caller's wishlist: target price, note, catalogue MSRP and the latest observed shop price per figure.",
        annotations(title = "Wishlist", read_only_hint = true, idempotent_hint = true)
    )]
    async fn list_wishlist(
        &self,
        Parameters(input): Parameters<dto::Paging>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "list_wishlist",
            Scope::CollectionRead,
            &input,
        )
        .await?;
        let items =
            crate::domain::wishlist::list(&self.state.pool, call.user_id(), call.hide_nsfw()).await;
        let paged = items.map(|all| {
            Page::of(
                all,
                dto::clamp_limit(input.limit),
                dto::clamp_offset(input.offset),
            )
        });
        call.finish(paged).await
    }

    #[tool(
        description = "The caller's pre-orders with their current expected release date, status, deposit and store. Release dates slip constantly in this hobby — get_preorder_history shows each slip.",
        annotations(title = "Pre-orders", read_only_hint = true, idempotent_hint = true)
    )]
    async fn list_preorders(
        &self,
        Parameters(input): Parameters<dto::ListPreorders>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "list_preorders",
            Scope::CollectionRead,
            &input,
        )
        .await?;
        let items = crate::domain::preorder::list_for_user(&self.state.pool, call.user_id())
            .await
            .map(|all| {
                let all = if input.open_only.unwrap_or(false) {
                    all.into_iter()
                        .filter(|p| !matches!(p.status.as_str(), "received" | "cancelled"))
                        .collect()
                } else {
                    all
                };
                Page::of(
                    all,
                    dto::clamp_limit(input.limit),
                    dto::clamp_offset(input.offset),
                )
            });
        call.finish(items).await
    }

    #[tool(
        description = "Every recorded change to one pre-order's expected release date, with the note and source of each slip.",
        annotations(
            title = "Pre-order date history",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_preorder_history(
        &self,
        Parameters(input): Parameters<dto::PreorderId>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_preorder_history",
            Scope::CollectionRead,
            &input,
        )
        .await?;
        let history =
            crate::domain::preorder::history(&self.state.pool, call.user_id(), input.preorder_id)
                .await;
        call.target(input.preorder_id).finish(history).await
    }

    #[tool(
        description = "How badly this caller's pre-orders slip, overall and per manufacturer: sample size and average delay in days. Useful for judging whether a maker's announced date is worth trusting.",
        annotations(
            title = "Pre-order slip statistics",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_preorder_slip_stats(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_preorder_slip_stats",
            Scope::CollectionRead,
            &(),
        )
        .await?;
        let pool = &self.state.pool;
        let uid = call.user_id();
        let result = match (
            crate::domain::preorder_slip::overall(pool, uid).await,
            crate::domain::preorder_slip::per_manufacturer(pool, uid).await,
        ) {
            (Ok(overall), Ok(by_manufacturer)) => Ok(serde_json::json!({
                "overall": overall,
                "by_manufacturer": by_manufacturer,
                "min_samples": crate::domain::preorder_slip::MIN_SAMPLES,
            })),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        call.finish(result).await
    }

    // ------------------------------------------------------ stats & data

    #[tool(
        description = "Aggregate statistics for the caller's collection: piece counts, spend and value per currency, EUR totals computed at the exchange rate frozen at each purchase, pre-order summary, top manufacturers/series/sculptors and price distribution.",
        annotations(
            title = "Collection statistics",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_collection_stats(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_collection_stats",
            Scope::StatsRead,
            &(),
        )
        .await?;
        let stats = crate::domain::stats::collection_stats(
            &self.state.pool,
            &self.state.http,
            call.user_id(),
        )
        .await;
        call.finish(stats).await
    }

    #[tool(
        description = "Deeper analysis of the caller's collection: spend per year, series completion, wishlist value, pre-order health (deposits at risk, average slip, cancellations) and the collection's tag 'DNA'.",
        annotations(title = "Insights", read_only_hint = true, idempotent_hint = true)
    )]
    async fn get_insights(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(&self.state, &ctx, "get_insights", Scope::StatsRead, &()).await?;
        let insights = crate::domain::stats::insights(&self.state.pool, call.user_id()).await;
        call.finish(insights).await
    }

    #[tool(
        description = "How the caller's collection grew over time, bucketed — pieces acquired and spend per period.",
        annotations(
            title = "Collection timeline",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_collection_timeline(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_collection_timeline",
            Scope::StatsRead,
            &(),
        )
        .await?;
        let timeline =
            crate::domain::stats::collection_timeline(&self.state.pool, call.user_id()).await;
        call.finish(timeline).await
    }

    #[tool(
        description = "The caller's recent collection activity, newest first: pieces added, pre-orders placed or received, dates that slipped.",
        annotations(title = "Activity", read_only_hint = true, idempotent_hint = true)
    )]
    async fn get_activity(
        &self,
        Parameters(input): Parameters<dto::Paging>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "get_activity", Scope::StatsRead, &input).await?;
        let events = crate::domain::activity::list_for_user(
            &self.state.pool,
            call.user_id(),
            crate::domain::activity::ListParams {
                limit: dto::clamp_limit(input.limit),
                offset: dto::clamp_offset(input.offset),
            },
        )
        .await;
        call.finish(events).await
    }

    #[tool(
        description = "A year in review for the caller: what they acquired that calendar year, what it cost, and the year's highlights.",
        annotations(
            title = "Year in review",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_year_in_review(
        &self,
        Parameters(input): Parameters<dto::YearInReview>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_year_in_review",
            Scope::StatsRead,
            &input,
        )
        .await?;
        if !(1990..=2100).contains(&input.year) {
            return call.refuse("year must be between 1990 and 2100").await;
        }
        let review =
            crate::domain::activity::year_in_review(&self.state.pool, call.user_id(), input.year)
                .await;
        call.finish(review).await
    }

    #[tool(
        description = "The caller's unlocked achievements and the milestones they are closest to reaching.",
        annotations(title = "Achievements", read_only_hint = true, idempotent_hint = true)
    )]
    async fn get_achievements(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "get_achievements", Scope::StatsRead, &()).await?;
        let uid = call.user_id();
        let result = match (
            crate::domain::achievement::list_for_user(&self.state.pool, uid).await,
            crate::domain::achievement::next_milestones(&self.state.db, &self.state.pool, uid)
                .await,
        ) {
            (Ok(unlocked), Ok(next)) => Ok(serde_json::json!({
                "unlocked": unlocked,
                "next_milestones": next,
            })),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        call.finish(result).await
    }

    #[tool(
        description = "The caller's in-app notifications (release reminders, price alerts, pre-order updates) and unread counts. Read-only: nothing is marked read.",
        annotations(title = "Notifications", read_only_hint = true, idempotent_hint = true)
    )]
    async fn get_notifications(
        &self,
        Parameters(input): Parameters<dto::ListNotifications>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_notifications",
            Scope::StatsRead,
            &input,
        )
        .await?;
        let pool = &self.state.pool;
        let uid = call.user_id();
        let result = match (
            crate::domain::notification::list_for_user(
                pool,
                uid,
                input.unread_only.unwrap_or(false),
                dto::clamp_limit(input.limit),
                dto::clamp_offset(input.offset),
            )
            .await,
            crate::domain::notification::counts_for_user(pool, uid).await,
        ) {
            (Ok(items), Ok(counts)) => Ok(serde_json::json!({
                "notifications": items,
                "counts": counts,
            })),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        call.finish(result).await
    }

    #[tool(
        description = "Observed market-price history across every figure the caller owns, or every figure they wish for — oldest first, tagged by figure, so you can see what has appreciated.",
        annotations(
            title = "Collection price history",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_price_history(
        &self,
        Parameters(input): Parameters<dto::PriceHistory>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "get_price_history",
            Scope::StatsRead,
            &input,
        )
        .await?;
        let uid = call.user_id();
        let history = match input.scope {
            dto::PriceHistoryScope::Owned => {
                crate::domain::figure_price::history_for_user_owned(&self.state.pool, uid).await
            }
            dto::PriceHistoryScope::Wished => {
                crate::domain::figure_price::history_for_user_wished(&self.state.pool, uid).await
            }
        };
        call.finish(history).await
    }
}
