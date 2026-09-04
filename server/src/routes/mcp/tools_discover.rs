//! Discovery tools: embedding-driven suggestions, and finding other
//! collectors.
//!
//! ## What is and isn't possible here
//!
//! The catalogue's free-text semantic search ("Sens") and its "search by look"
//! both take a **query embedding computed in the caller's browser** — e5 for
//! text, the SigLIP2 text tower for look. The server never embeds a query
//! string; it only stores image and text vectors built by the GPU worker.
//!
//! So there is no `search_by_description` tool to write: an MCP client has no
//! way to produce the vector those endpoints need. What *is* server-side —
//! neighbours of a figure, and recommendations from what the caller owns — is
//! exposed below. For "find me figures that look like X", the appearance-tag
//! filter on `search_catalogue` is the reachable equivalent, and its tags come
//! from the same tagger.

use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult,
    service::RequestContext, tool, tool_router,
};

use super::ctx;
use super::dto;
use super::server::FcMcp;
use crate::domain::api_key::Scope;
use crate::domain::{settings, visual_search};
use crate::error::AppError;
use crate::routes::visual_search as vs_route;

#[tool_router(router = tool_router_discover, vis = "pub")]
impl FcMcp {
    #[tool(
        description = "Catalogue figures visually closest to a given one, by image embedding — the 'figurines proches' rail. Needs the instance's photo-search feature switched on and its index built; says so plainly if not.",
        annotations(
            title = "Similar figures",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn find_similar_figures(
        &self,
        Parameters(input): Parameters<dto::FigureId>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "find_similar_figures",
            Scope::SearchAi,
            &input,
        )
        .await?;
        if let Some(refusal) = self.embedding_search_unavailable().await {
            return call.refuse(refusal).await;
        }
        let result = self
            .neighbours(input.figure_id, call.hide_nsfw())
            .await
            .map(with_note);
        call.target(input.figure_id).finish(result).await
    }

    #[tool(
        description = "Catalogue figures close to what the caller already owns, excluding anything they own or already wish for — a 'you might like' list derived from their collection, not from browsing history. Needs the photo-search feature on and indexed.",
        annotations(
            title = "Recommendations",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn recommend_figures(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "recommend_figures", Scope::SearchAi, &()).await?;
        if let Some(refusal) = self.embedding_search_unavailable().await {
            return call.refuse(refusal).await;
        }
        let result = self
            .recommendations_for(call.user_id(), call.hide_nsfw())
            .await
            .map(with_note);
        call.finish(result).await
    }

    #[tool(
        description = "Find other collectors on this instance by name, with their public piece counts. Read-only: following someone is a social action with an audience and is not available through MCP. Only collectors who made their profile public are visible.",
        annotations(
            title = "Find collectors",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn search_collectors(
        &self,
        Parameters(input): Parameters<dto::SearchCollectors>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "search_collectors",
            Scope::SocialRead,
            &input,
        )
        .await?;
        let found = crate::domain::follow::discover(
            &self.state.pool,
            call.user_id(),
            input.q.as_deref().unwrap_or_default(),
        )
        .await
        // Only public profiles, whatever the underlying query returns.
        .map(|cards| {
            cards
                .into_iter()
                .filter(|c| c.is_public)
                .collect::<Vec<_>>()
        });
        call.finish(found).await
    }
}

impl FcMcp {
    /// Why embedding-driven discovery can't answer right now, or `None` if it
    /// can. Returning the reason beats returning an empty list, which an agent
    /// would report as "nothing similar exists".
    async fn embedding_search_unavailable(&self) -> Option<&'static str> {
        match settings::visual_search_enabled(&self.state.pool).await {
            Ok(true) => None,
            Ok(false) => Some(
                "photo search is switched off on this instance, so there are no embeddings to \
                 compare. An administrator enables it in Réglages → Administration; the catalogue \
                 then has to be indexed by the embedding worker before this returns anything. \
                 In the meantime, search_catalogue with a `tag` filter is the closest thing.",
            ),
            Err(e) => {
                tracing::error!(error = %e, "could not read the photo-search flag");
                Some("could not determine whether photo search is available")
            }
        }
    }

    async fn neighbours(
        &self,
        figure_id: uuid::Uuid,
        hide_nsfw: bool,
    ) -> Result<Vec<vs_route::ScoredFigure>, AppError> {
        let max_distance = vs_route::max_distance_for_threshold(&self.state.pool).await?;
        let candidates = visual_search::similar_figures(
            &self.state.pool,
            figure_id,
            visual_search::MODEL_VERSION,
            vs_route::SIMILAR_K,
            max_distance,
        )
        .await?;
        vs_route::hydrate(&self.state.pool, candidates, hide_nsfw).await
    }

    async fn recommendations_for(
        &self,
        user_id: uuid::Uuid,
        hide_nsfw: bool,
    ) -> Result<Vec<vs_route::ScoredFigure>, AppError> {
        let max_distance = vs_route::max_distance_for_threshold(&self.state.pool).await?;
        let candidates = visual_search::recommendations(
            &self.state.pool,
            user_id,
            visual_search::MODEL_VERSION,
            vs_route::RECO_K,
            max_distance,
        )
        .await?;
        vs_route::hydrate(&self.state.pool, candidates, hide_nsfw).await
    }
}

/// An empty result here is ambiguous — no neighbours, or nothing indexed yet?
/// Say which, so the answer isn't "there are no similar figures".
fn with_note(matches: Vec<vs_route::ScoredFigure>) -> serde_json::Value {
    let note = if matches.is_empty() {
        Some(
            "no matches. Either nothing in the catalogue is close enough at the instance's \
             similarity floor, or these figures have no embeddings yet (the worker indexes \
             them in the background).",
        )
    } else {
        None
    };
    serde_json::json!({ "matches": matches, "note": note })
}
