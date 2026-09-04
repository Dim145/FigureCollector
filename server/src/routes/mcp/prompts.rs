//! Server-side prompts: the questions this collection is actually asked.
//!
//! A prompt is a starting point a client can offer its user by name, so the
//! useful questions don't have to be reinvented each time. They deliberately
//! *describe an approach* rather than dictate an answer — each one names the
//! tools to use and the traps to avoid (mixing currencies, trusting an
//! announced release date, treating an appraisal as a valuation).
//!
//! They carry no scopes of their own: fetching a prompt reveals nothing, and
//! the tools it suggests enforce their own scopes when the model gets there.

use rmcp::{
    ErrorData,
    handler::server::wrapper::Parameters,
    model::{PromptMessage, Role},
    prompt, prompt_router,
    schemars::JsonSchema,
};
use serde::{Deserialize, Serialize};

use super::server::FcMcp;

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct BudgetArgs {
    /// How much there is to spend, as a decimal string (e.g. "200").
    pub budget: Option<String>,
    /// ISO-4217 code for `budget`. Defaults to the account's preferred
    /// currency.
    pub currency: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct YearArgs {
    /// Calendar year to review.
    pub year: Option<String>,
}

fn user(text: impl Into<String>) -> Vec<PromptMessage> {
    vec![PromptMessage::new_text(Role::User, text)]
}

#[prompt_router(vis = "pub")]
impl FcMcp {
    /// Review the collection and say something useful about it.
    #[prompt(
        name = "audit_collection",
        description = "Survey the collection and report what stands out: concentration, gaps, condition risk and money."
    )]
    async fn audit_collection(&self) -> Result<Vec<PromptMessage>, ErrorData> {
        Ok(user(
            "Audit my figurine collection.\n\n\
             Start with get_collection_stats and get_insights, then list_owned_items for detail.\n\n\
             Cover:\n\
             - shape: how concentrated it is by maker, series and scale, and whether that looks \
               deliberate;\n\
             - money: what it cost against what it's worth. Use the EUR totals from \
               get_collection_stats (they're computed at the rate frozen when each piece was \
               bought) and quote the `fx_date`; if `partial` is true, say the totals are \
               incomplete. Never add up amounts in different currencies yourself;\n\
             - condition: pieces graded C or J, or flagged missing_parts / no_box;\n\
             - gaps: series in get_insights.series_completion sitting just short of complete.\n\n\
             Be concrete and cite the pieces you're talking about. If something looks like a \
             data-entry mistake rather than a real fact, say so instead of reasoning from it.",
        ))
    }

    /// Suggest what to buy next, within a budget.
    #[prompt(
        name = "what_to_buy_next",
        description = "Pick what to buy next from the wishlist and recommendations, within a stated budget."
    )]
    async fn what_to_buy_next(
        &self,
        Parameters(args): Parameters<BudgetArgs>,
    ) -> Result<Vec<PromptMessage>, ErrorData> {
        let budget = match (args.budget.as_deref(), args.currency.as_deref()) {
            (Some(b), Some(c)) => format!("I have about {b} {c} to spend."),
            (Some(b), None) => format!("I have about {b} to spend."),
            _ => "I haven't fixed a budget — tell me what it would cost.".to_string(),
        };
        Ok(user(format!(
            "What should I buy next? {budget}\n\n\
             Work from list_wishlist first — those are choices I've already made. Check each \
             one's target price against the latest observed price (get_figure_price_history), \
             and say which are currently near or below what I said I'd pay.\n\n\
             Then, if the instance has it available, add recommend_figures for things I haven't \
             thought of, and say plainly that those are suggestions from what I own rather than \
             from my wishlist.\n\n\
             For anything shipping from abroad, use estimate_landed_cost so the number I hear \
             includes duty and VAT — and repeat its disclaimer. Compare prices only within the \
             same currency; if the wishlist mixes currencies, keep them separate rather than \
             converting.\n\n\
             Don't buy anything, don't add anything to my collection, and don't change my \
             wishlist. Just tell me what you'd pick and why.",
        )))
    }

    /// What's coming, and what's late.
    #[prompt(
        name = "preorder_briefing",
        description = "Brief me on pending pre-orders: what's due, what's slipping, and how much is committed."
    )]
    async fn preorder_briefing(&self) -> Result<Vec<PromptMessage>, ErrorData> {
        Ok(user(
            "Brief me on my pre-orders.\n\n\
             Use list_preorders with open_only true, then get_preorder_slip_stats.\n\n\
             Tell me:\n\
             - what's due in the next three months, by current expected date;\n\
             - which dates have already moved, and by how much — get_preorder_history has the \
               slip record per pre-order;\n\
             - how much money is committed in deposits, per currency;\n\
             - which announced dates I shouldn't trust. The slip statistics are per manufacturer; \
               use them, but ignore makers with fewer samples than `min_samples`, where the \
               average is noise.\n\n\
             Flag anything still marked 'preordered' whose date is already in the past — that's \
             usually a record I forgot to update, not a late delivery.",
        ))
    }

    /// Prepare the paperwork side of an insurance claim or valuation.
    #[prompt(
        name = "insurance_prep",
        description = "Assemble what an insurer would ask for: values, condition records and gaps in the documentation."
    )]
    async fn insurance_prep(&self) -> Result<Vec<PromptMessage>, ErrorData> {
        Ok(user(
            "Help me get my collection ready for an insurance valuation.\n\n\
             Use list_owned_items and get_collection_stats.\n\n\
             Produce:\n\
             - the total insurable value per currency, with the EUR figure and its `fx_date` \
               alongside;\n\
             - the pieces that dominate that total — the ones worth listing individually;\n\
             - which pieces have no recorded value at all (they fall back to catalogue MSRP, \
               which is not the same thing) and which have no purchase price on file;\n\
             - condition notes an insurer would want to know about up front.\n\n\
             Two things to be clear about: what you produce is a summary of my own records, not \
             an appraisal, and the app's PDF dossier export (Réglages → exports) is what actually \
             bundles the invoices — you can't generate it from here.",
        ))
    }

    /// The year, as the collection saw it.
    #[prompt(
        name = "year_in_review",
        description = "Recap a collecting year: what arrived, what it cost, what the year was about."
    )]
    async fn year_in_review(
        &self,
        Parameters(args): Parameters<YearArgs>,
    ) -> Result<Vec<PromptMessage>, ErrorData> {
        let year = args
            .year
            .as_deref()
            .map(|y| format!("for {y}"))
            .unwrap_or_else(|| "for the current year".to_string());
        Ok(user(format!(
            "Write me a year in review {year}.\n\n\
             Use get_year_in_review for that year, get_collection_timeline for how it sits \
             against other years, and get_activity if you need the detail.\n\n\
             I'd like: what arrived and when, what it cost (per currency), which piece was the \
             year's centrepiece, and how the year compared with the one before. Then one honest \
             observation about where the collection is heading.\n\n\
             Write it as prose, not a table. If the year is thin, say so plainly rather than \
             padding it.",
        )))
    }

    /// Find the series that are nearly complete.
    #[prompt(
        name = "find_series_gaps",
        description = "Find the series closest to complete and what's missing from each."
    )]
    async fn find_series_gaps(&self) -> Result<Vec<PromptMessage>, ErrorData> {
        Ok(user(
            "Which series am I closest to completing?\n\n\
             get_insights has series_completion (owned versus total per series). Take the ones \
             within a piece or two of complete, then use browse_entity with kind 'series' to see \
             which specific figures are missing, and check list_wishlist to see if I already \
             know about them.\n\n\
             For each near-complete series tell me what's left, whether it's still available or \
             a secondary-market hunt (the catalogue's release dates and observed prices are the \
             clue), and roughly what finishing it would cost.\n\n\
             Note that 'total' counts what this instance's catalogue knows about, not everything \
             the maker ever released — say so if a series looks suspiciously short.",
        ))
    }
}
