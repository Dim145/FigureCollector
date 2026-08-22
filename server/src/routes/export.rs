//! Data export endpoints (Lot 5) — download the signed-in user's collection /
//! wishlist / preorders as CSV or JSON, or a single-file JSON backup.
//!
//! Every response carries `Content-Disposition: attachment` so the browser
//! saves a file instead of rendering it. Auth-gated to the session user; a
//! plain `<a href download>` works because the cookie rides along.

use crate::auth;
use crate::domain::{export, owned_document as doc};
use crate::error::{AppError, AppResult};
use crate::services::{dossier, invoice};
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use tower_sessions::Session;
use uuid::Uuid;

const CSV: &str = "text/csv; charset=utf-8";
const JSON: &str = "application/json; charset=utf-8";

fn attachment(filename: &str, content_type: &str, body: String) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        body,
    )
}

async fn collection_csv(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "collection.csv",
        CSV,
        export::collection_csv(&state.pool, uid).await?,
    ))
}

async fn collection_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "collection.json",
        JSON,
        export::collection_json(&state.pool, uid).await?,
    ))
}

async fn wishlist_csv(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "wishlist.csv",
        CSV,
        export::wishlist_csv(&state.pool, uid).await?,
    ))
}

async fn wishlist_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "wishlist.json",
        JSON,
        export::wishlist_json(&state.pool, uid).await?,
    ))
}

async fn preorders_csv(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "preorders.csv",
        CSV,
        export::preorders_csv(&state.pool, uid).await?,
    ))
}

async fn preorders_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "preorders.json",
        JSON,
        export::preorders_json(&state.pool, uid).await?,
    ))
}

async fn backup_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "figurecollector-backup.json",
        JSON,
        export::backup_json(&state.pool, uid).await?,
    ))
}

// ── Insurance dossier (merged PDF: inventory cover + each item's invoices) ───
//
// Hybrid: the SPA builds the inventory-table cover with its existing jsPDF
// generator and POSTs the bytes here as `cover`, plus a `manifest` listing the
// items (already-localized titles) and the localized separator labels. We never
// re-implement the table server-side. For each item that has documents we fetch
// the blobs from storage and (off the async runtime) merge: cover → per-figure
// separator → that figure's invoice pages.

#[derive(serde::Deserialize)]
struct DossierManifest {
    items: Vec<DossierItem>,
    #[serde(default)]
    labels: DossierLabels,
}

#[derive(serde::Deserialize)]
struct DossierItem {
    owned_id: Uuid,
    title: String,
}

/// Localized strings the SPA hands us so the server interpolates without owning
/// any i18n itself. All optional — an empty label just drops that fragment.
#[derive(serde::Deserialize, Default)]
struct DossierLabels {
    #[serde(default)]
    kicker: String, // e.g. "JUSTIFICATIFS"
    #[serde(default)]
    documents: String, // e.g. "justificatif(s)"
    #[serde(default)]
    paid: String, // e.g. "Total payé"
    #[serde(default)]
    purchased_on: String, // e.g. "le"
    #[serde(default)]
    unreadable: String, // e.g. "Justificatif illisible"
}

/// Compose a section subtitle from the item's parsed invoices + document count.
fn build_subtitle(parsed_json: &[serde_json::Value], doc_count: usize, labels: &DossierLabels) -> String {
    let parsed: Vec<invoice::ParsedInvoice> = parsed_json
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();
    let rollup = invoice::compute_rollup(&parsed);

    let mut parts: Vec<String> = Vec::new();
    if let Some(store) = rollup.store.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        parts.push(store.to_string());
    }
    if !labels.documents.is_empty() {
        parts.push(format!("{doc_count} {}", labels.documents));
    }
    if let (Some(total), Some(cur)) = (rollup.total_paid, rollup.currency.as_deref()) {
        let amt = format!("{total} {cur}");
        parts.push(if labels.paid.is_empty() {
            amt
        } else {
            format!("{} {amt}", labels.paid)
        });
    }
    if let Some(d) = rollup.latest_date {
        parts.push(if labels.purchased_on.is_empty() {
            d.to_string()
        } else {
            format!("{} {d}", labels.purchased_on)
        });
    }
    parts.join("  ·  ")
}

async fn insurance_dossier(
    State(state): State<AppState>,
    session: Session,
    mut multipart: Multipart,
) -> AppResult<Response> {
    let uid = auth::require_user(&session).await?;
    if !state.storage.enabled() {
        return Err(AppError::FeatureDisabled("object storage is not configured"));
    }

    // 1. Parse multipart: the cover PDF bytes + the manifest JSON.
    let mut cover: Option<Vec<u8>> = None;
    let mut manifest: Option<DossierManifest> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(error = %e, "dossier multipart framing error");
        AppError::BadRequest("malformed multipart request")
    })? {
        match field.name() {
            Some("cover") => {
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::BadRequest("could not read cover"))?;
                cover = Some(data.to_vec());
            }
            Some("manifest") => {
                let txt = field
                    .text()
                    .await
                    .map_err(|_| AppError::BadRequest("could not read manifest"))?;
                manifest = Some(
                    serde_json::from_str(&txt)
                        .map_err(|_| AppError::BadRequest("invalid manifest JSON"))?,
                );
            }
            _ => {}
        }
    }
    let cover = cover.ok_or(AppError::BadRequest("missing 'cover' field"))?;
    let manifest = manifest.ok_or(AppError::BadRequest("missing 'manifest' field"))?;
    if !cover.starts_with(b"%PDF-") {
        return Err(AppError::BadRequest("cover is not a PDF"));
    }

    // 2. Which of THIS user's items actually have documents (one user-scoped
    //    query — also the ownership gate: a forged owned_id won't be in the set).
    let with_docs = doc::item_ids_with_documents(&state.pool, uid).await?;

    // 3. Build sections in the manifest's order, pulling each blob from storage.
    let mut sections: Vec<dossier::Section> = Vec::new();
    for item in &manifest.items {
        if !with_docs.contains(&item.owned_id) {
            continue;
        }
        let metas = doc::list_for_merge(&state.pool, item.owned_id).await?;
        if metas.is_empty() {
            continue;
        }
        let parsed_json = doc::list_parsed_metadata(&state.pool, item.owned_id).await?;
        let subtitle = build_subtitle(&parsed_json, metas.len(), &manifest.labels);

        let mut docs: Vec<dossier::DocPart> = Vec::new();
        for (storage_key, mime, filename) in metas {
            match state.storage.get(&storage_key).await {
                Ok((bytes, _)) => docs.push(dossier::DocPart {
                    mime,
                    bytes,
                    filename,
                }),
                Err(e) => {
                    tracing::warn!(error = ?e, %storage_key, "dossier: blob fetch failed; skipping document");
                }
            }
        }
        if docs.is_empty() {
            continue;
        }
        sections.push(dossier::Section {
            title: item.title.clone(),
            subtitle,
            docs,
        });
    }

    if sections.is_empty() {
        return Err(AppError::BadRequest("no documents to include in the dossier"));
    }

    // 4. Assemble off the async runtime (lopdf/printpdf are CPU-bound + blocking).
    // Share the PDF-parse concurrency cap: each dossier merges + empty-password-
    // decrypts every attached PDF, so a burst of large-collection exports could
    // otherwise exhaust CPU / RSS on the memory-capped container.
    let kicker = manifest.labels.kicker.clone();
    let unreadable = manifest.labels.unreadable.clone();
    let _parse_permit = crate::services::invoice::acquire_pdf_parse_permit().await;
    let pdf = tokio::task::spawn_blocking(move || dossier::build(&cover, sections, &kicker, &unreadable))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("dossier task panicked: {e}")))?
        .map_err(|e| AppError::Internal(anyhow::anyhow!("dossier merge failed: {e}")))?;

    tracing::info!(user_id = %uid, bytes = pdf.len(), "insurance dossier generated");
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("application/pdf")),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_static("attachment; filename=\"dossier-assurance.pdf\""),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
        ],
        Body::from(pdf),
    )
        .into_response())
}

/// Import options + payload in one body: the SPA sends the parsed backup with
/// `dry_run` first (preview), then again with `dry_run: false` once the user has
/// seen what would happen.
#[derive(serde::Deserialize)]
struct ImportRequest {
    #[serde(default = "default_true")]
    dry_run: bool,
    #[serde(default)]
    policy: crate::domain::import::MergePolicy,
    /// Allow seeding the SHARED catalogue with figures the file references but
    /// this instance doesn't have. Off by default — see domain::import.
    #[serde(default)]
    create_missing: bool,
    #[serde(default)]
    backup: crate::domain::import::BackupFile,
}

fn default_true() -> bool {
    true
}

#[derive(serde::Serialize)]
#[serde(untagged)]
enum ImportResponse {
    Preview(crate::domain::import::ImportPlan),
    Applied(crate::domain::import::ImportResult),
}

/// Restore a backup into the SESSION user's collection. Never trusts the
/// `user` block in the file — a backup can only ever write to whoever is
/// signed in.
async fn import_backup(
    State(state): State<AppState>,
    session: Session,
    Json(req): Json<ImportRequest>,
) -> AppResult<Json<ImportResponse>> {
    let user_id = auth::require_user(&session).await?;
    if req.dry_run {
        Ok(Json(ImportResponse::Preview(
            crate::domain::import::preview(&state.pool, user_id, &req.backup).await?,
        )))
    } else {
        Ok(Json(ImportResponse::Applied(
            crate::domain::import::apply(
                &state.pool,
                user_id,
                &req.backup,
                req.policy,
                req.create_missing,
            )
            .await?,
        )))
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/import/backup", post(import_backup))
        .route("/me/export/collection.csv", get(collection_csv))
        .route("/me/export/collection.json", get(collection_json))
        .route("/me/export/wishlist.csv", get(wishlist_csv))
        .route("/me/export/wishlist.json", get(wishlist_json))
        .route("/me/export/preorders.csv", get(preorders_csv))
        .route("/me/export/preorders.json", get(preorders_json))
        .route("/me/export/backup.json", get(backup_json))
}

/// The dossier POST lives in its own router so `build_router` can give it a
/// raised multipart body limit (the cover PDF + manifest), like the document
/// upload routes — the plain `router()` GET endpoints keep axum's default.
pub fn dossier_router() -> Router<AppState> {
    Router::new().route("/me/export/insurance-dossier", post(insurance_dossier))
}
