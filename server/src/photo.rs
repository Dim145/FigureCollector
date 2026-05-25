//! Shared image-sanitization pipeline.
//!
//! The same decode + dimension-check + re-encode-to-WebP routine is used
//! by per-user photos, catalog (figure) photos, scan frames, and admin
//! entity photos. Centralising it here means:
//!
//!   1. A single place to audit (EXIF strip + format whitelist + dimension
//!      cap is a security boundary).
//!   2. The CPU-bound work runs on `tokio::task::spawn_blocking` — keeping
//!      a 4 K image decode + WebP re-encode off the runtime's worker thread,
//!      so multi-megapixel uploads (especially the 96-frame scan upload)
//!      don't starve every other in-flight request on the same thread.
//!   3. The 4 multipart routes that need it shrink to one function call.

use crate::error::{AppError, AppResult};
use image::ImageFormat;
use std::io::Cursor;

/// Format-validate, decode, dimension-check and re-encode `raw` as WebP.
/// Returns `(cleaned_bytes, width, height)`.
///
/// `max_dim` is the per-side cap applied to BOTH width and height.
///
/// The whole decode + encode happens inside `spawn_blocking` — a 4 K JPEG
/// re-encode is ~50-300 ms of pure CPU, more than enough to stall the
/// runtime worker for every other awaitable on the same thread.
pub async fn sanitize_to_webp(raw: Vec<u8>, max_dim: u32) -> AppResult<(Vec<u8>, u32, u32)> {
    // The image crate's API is fully synchronous; the right place for this
    // is `spawn_blocking`. We move `raw` in and ship the cleaned bytes
    // back.
    tokio::task::spawn_blocking(move || sanitize_to_webp_blocking(&raw, max_dim))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("image sanitize task panicked: {e}")))?
}

fn sanitize_to_webp_blocking(raw: &[u8], max_dim: u32) -> AppResult<(Vec<u8>, u32, u32)> {
    let format = image::guess_format(raw)
        .map_err(|_| AppError::BadRequest("unrecognised image format"))?;
    match format {
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP => {}
        _ => return Err(AppError::BadRequest(
            "unsupported image format (use JPEG, PNG or WebP)",
        )),
    }
    let img = image::load_from_memory_with_format(raw, format)
        .map_err(|_| AppError::BadRequest("could not decode image"))?;
    let (w, h) = (img.width(), img.height());
    if w > max_dim || h > max_dim {
        return Err(AppError::BadRequest(
            "image dimensions too large for this upload type",
        ));
    }
    let mut cleaned = Vec::with_capacity(raw.len() / 2);
    img.write_to(&mut Cursor::new(&mut cleaned), ImageFormat::WebP)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("WebP encode failed: {e}")))?;
    Ok((cleaned, w, h))
}
