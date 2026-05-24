//! Object storage — Garage (S3-compatible).
//!
//! We use `rust-s3` rather than the official AWS SDK to avoid dragging the
//! whole smithy runtime + native-tls stack into the scratch image. Rustls
//! everywhere, no OpenSSL.

use crate::error::{AppError, AppResult};
use s3::{Bucket, Region, creds::Credentials};
use std::env;

#[derive(Clone)]
pub struct Storage {
    pub bucket: Option<Box<Bucket>>,
    pub bucket_name: String,
}

impl Storage {
    /// Build the storage client from `S3_*` env vars. Returns a no-op storage
    /// when credentials are missing (so the server still boots even without a
    /// configured bucket — photo uploads will fail with a clear error then).
    pub fn from_env() -> anyhow::Result<Self> {
        let endpoint = env::var("S3_ENDPOINT").ok();
        let bucket_name = env::var("S3_BUCKET").unwrap_or_else(|_| "figurecollector".into());
        let access_key = env::var("S3_ACCESS_KEY").ok();
        let secret_key = env::var("S3_SECRET_KEY").ok();
        let region_str = env::var("S3_REGION").unwrap_or_else(|_| "garage".into());
        let path_style = env::var("S3_FORCE_PATH_STYLE")
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
            .unwrap_or(true);

        let Some(endpoint) = endpoint else {
            tracing::warn!("S3_ENDPOINT not set — photo uploads will be disabled");
            return Ok(Self {
                bucket: None,
                bucket_name,
            });
        };
        let Some(access_key) = access_key else {
            tracing::warn!("S3_ACCESS_KEY not set — photo uploads will be disabled");
            return Ok(Self {
                bucket: None,
                bucket_name,
            });
        };
        let Some(secret_key) = secret_key else {
            tracing::warn!("S3_SECRET_KEY not set — photo uploads will be disabled");
            return Ok(Self {
                bucket: None,
                bucket_name,
            });
        };

        let region = Region::Custom {
            region: region_str,
            endpoint,
        };
        let credentials =
            Credentials::new(Some(&access_key), Some(&secret_key), None, None, None)?;

        let bucket = Bucket::new(&bucket_name, region, credentials)?;
        let bucket = if path_style {
            bucket.with_path_style()
        } else {
            bucket
        };

        Ok(Self {
            bucket: Some(bucket),
            bucket_name,
        })
    }

    pub fn enabled(&self) -> bool {
        self.bucket.is_some()
    }

    fn bucket(&self) -> AppResult<&Bucket> {
        self.bucket
            .as_deref()
            .ok_or(AppError::FeatureDisabled("object storage is not configured"))
    }

    pub async fn put(&self, key: &str, content: &[u8], mime: &str) -> AppResult<()> {
        let bucket = self.bucket()?;
        bucket
            .put_object_with_content_type(key, content, mime)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Garage put failed: {e}")))?;
        Ok(())
    }

    /// Returns (bytes, content-type).
    pub async fn get(&self, key: &str) -> AppResult<(Vec<u8>, Option<String>)> {
        let bucket = self.bucket()?;
        let resp = bucket
            .get_object(key)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Garage get failed: {e}")))?;
        if !(200..300).contains(&resp.status_code()) {
            return Err(AppError::NotFound);
        }
        let mime = resp.headers().get("content-type").cloned();
        Ok((resp.bytes().to_vec(), mime))
    }

    pub async fn delete(&self, key: &str) -> AppResult<()> {
        let bucket = self.bucket()?;
        bucket
            .delete_object(key)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Garage delete failed: {e}")))?;
        Ok(())
    }
}
