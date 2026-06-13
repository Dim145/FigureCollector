//! Google Cloud Vision — Web Detection (reverse-image lookup).
//!
//! Used ONLY for the opt-in external fallback of photo search: when the
//! in-catalog ANN finds nothing, the user may consent to send the photo to
//! Google, which returns recognised web entities, a best-guess label, and pages
//! hosting the same image. We distill those into identification hints so the
//! user can then add the figure by hand (manual entry stays the backbone).
//!
//! Authenticated with an admin-configured API key passed as `?key=` — the
//! simplest scheme for a self-hosted instance. The call goes out over the
//! shared rustls `reqwest::Client`; the host is fixed (no user-controlled URL),
//! so there's no SSRF surface here.

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const VISION_ENDPOINT: &str = "https://vision.googleapis.com/v1/images:annotate";
const MAX_RESULTS: u32 = 10;
/// Defensive caps so a noisy response can't bloat our payload.
const MAX_ENTITIES: usize = 8;
const MAX_PAGES: usize = 8;
const MAX_SIMILAR: usize = 8;

/// One web page hosting a matching image — a lead the user can open to identify
/// the figure.
#[derive(Debug, Serialize)]
pub struct MatchingPage {
    pub url: String,
    pub title: Option<String>,
}

/// Distilled Web Detection result — only the fields useful for identification.
#[derive(Debug, Serialize, Default)]
pub struct WebHints {
    /// Google's single best textual guess (e.g. "tatsumaki figure").
    pub best_guess: Option<String>,
    /// Recognised web entities, most-confident first (deduped, non-empty).
    pub entities: Vec<String>,
    /// Pages that contain a full or partial match of the photo.
    pub pages: Vec<MatchingPage>,
    /// Visually-similar image URLs (thumbnails to eyeball).
    pub similar_images: Vec<String>,
}

/// Run Web Detection on `image_bytes`. Maps any upstream/transport/parse
/// failure to `ServiceUnavailable` (the photo search is best-effort — the user
/// can always fall back to manual entry).
pub async fn web_detection(
    http: &reqwest::Client,
    api_key: &str,
    image_bytes: &[u8],
) -> AppResult<WebHints> {
    let content = base64::engine::general_purpose::STANDARD.encode(image_bytes);
    let body = serde_json::json!({
        "requests": [{
            "image": { "content": content },
            "features": [{ "type": "WEB_DETECTION", "maxResults": MAX_RESULTS }],
        }]
    });
    let resp = http
        .post(VISION_ENDPOINT)
        .query(&[("key", api_key)])
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "google vision request failed");
            AppError::ServiceUnavailable("image recognition service unreachable")
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        // Body may carry Google's error detail — log it (server-side only), but
        // never surface it to the client (it can echo the API key context).
        let detail = resp.text().await.unwrap_or_default();
        tracing::warn!(%status, detail, "google vision returned an error status");
        return Err(AppError::ServiceUnavailable("image recognition service error"));
    }
    let parsed: VisionResponse = resp.json().await.map_err(|e| {
        tracing::warn!(error = %e, "google vision response parse failed");
        AppError::ServiceUnavailable("image recognition returned an unexpected response")
    })?;
    Ok(parsed.into_hints())
}

// ── Raw response shapes (only the fields we read) ────────────────────────────
#[derive(Deserialize)]
struct VisionResponse {
    #[serde(default)]
    responses: Vec<AnnotateResponse>,
}
#[derive(Deserialize)]
struct AnnotateResponse {
    #[serde(rename = "webDetection")]
    web_detection: Option<WebDetection>,
}
#[derive(Deserialize)]
struct WebDetection {
    #[serde(default, rename = "webEntities")]
    web_entities: Vec<WebEntity>,
    #[serde(default, rename = "bestGuessLabels")]
    best_guess_labels: Vec<BestGuess>,
    #[serde(default, rename = "pagesWithMatchingImages")]
    pages: Vec<PageMatch>,
    #[serde(default, rename = "visuallySimilarImages")]
    similar: Vec<ImageRef>,
}
#[derive(Deserialize)]
struct WebEntity {
    #[serde(default)]
    description: String,
}
#[derive(Deserialize)]
struct BestGuess {
    #[serde(default)]
    label: String,
}
#[derive(Deserialize)]
struct PageMatch {
    url: String,
    #[serde(default, rename = "pageTitle")]
    page_title: String,
}
#[derive(Deserialize)]
struct ImageRef {
    url: String,
}

impl VisionResponse {
    fn into_hints(self) -> WebHints {
        let Some(wd) = self.responses.into_iter().next().and_then(|r| r.web_detection) else {
            return WebHints::default();
        };
        let best_guess = wd
            .best_guess_labels
            .into_iter()
            .map(|b| b.label.trim().to_string())
            .find(|l| !l.is_empty());

        // Entities arrive most-confident first; keep order, drop blanks +
        // case-insensitive duplicates, cap the count.
        let mut seen = std::collections::HashSet::new();
        let entities = wd
            .web_entities
            .into_iter()
            .map(|e| e.description.trim().to_string())
            .filter(|d| !d.is_empty() && seen.insert(d.to_lowercase()))
            .take(MAX_ENTITIES)
            .collect();

        let pages = wd
            .pages
            .into_iter()
            .filter(|p| !p.url.trim().is_empty())
            .take(MAX_PAGES)
            .map(|p| MatchingPage {
                url: p.url,
                title: Some(p.page_title.trim().to_string()).filter(|t| !t.is_empty()),
            })
            .collect();

        let similar_images = wd
            .similar
            .into_iter()
            .map(|i| i.url)
            .filter(|u| !u.trim().is_empty())
            .take(MAX_SIMILAR)
            .collect();

        WebHints { best_guess, entities, pages, similar_images }
    }
}
