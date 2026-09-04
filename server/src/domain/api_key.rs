//! Per-user API keys + the MCP audit trail.
//!
//! These keys are the credential for the MCP endpoint (`/mcp`) — the one place
//! in the app authenticated by a bearer token rather than the `fc_session`
//! cookie. A user mints one key per MCP client, picks its scopes, and can
//! revoke it individually.
//!
//! ## Token shape
//!
//! `fck_<prefix>_<secret>`, where `prefix` is 16 hex chars (64 bits) and
//! `secret` is 64 hex chars (256 bits).
//!
//! The split is deliberate. The prefix is public: it carries a unique index,
//! so resolving a presented token is one indexed lookup, and it is safe to
//! show in the UI so a user can tell their keys apart. The secret is never
//! stored — only its SHA-256, compared in constant time.
//!
//! SHA-256 rather than Argon2id (which `auth::local` uses for passwords) is
//! the right call here and not a shortcut: the secret is 256 bits of CSPRNG
//! output, so there is no low-entropy guess to slow down, while a per-row salt
//! would forbid the index that keeps the per-request cost near zero.

use crate::domain::gift::mint_token;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use std::collections::BTreeSet;
use std::str::FromStr;
use uuid::Uuid;

/// Human-visible marker so a leaked string is recognisable as a
/// FigureCollector key (and greppable in logs / secret scanners).
pub const TOKEN_MARKER: &str = "fck_";
const PREFIX_LEN: usize = 16;
const SECRET_LEN: usize = 64;

/// Keys never outlive this, whatever the caller asks for. Public because the
/// route bounds-checks against it before doing date arithmetic that would
/// otherwise panic (see `routes::mcp_keys`).
pub const MAX_LIFETIME_DAYS: i64 = 3650;
/// How many live keys one user may hold at once.
pub const MAX_KEYS_PER_USER: i64 = 20;
/// Audit rows older than this are pruned opportunistically.
const AUDIT_RETENTION_DAYS: i32 = 90;

// ---------------------------------------------------------------- scopes

/// One capability a key may carry. Scopes are an explicit allow-list: a key
/// with an empty set can do nothing, and there is no wildcard.
///
/// Deliberately absent, and not addable by any scope: administration, account
/// and privacy settings, share-token minting, outbound scraping, and anything
/// that spends money or GPU time. See `routes::mcp` for the full rationale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Scope {
    /// Read the shared figure catalogue and its entity lookups.
    #[serde(rename = "catalogue:read")]
    CatalogueRead,
    /// Create catalogue entries, and edit the ones this user created.
    #[serde(rename = "catalogue:write")]
    CatalogueWrite,
    /// Read owned items, wishlist and pre-orders.
    #[serde(rename = "collection:read")]
    CollectionRead,
    /// Add to / edit / archive the collection (reversible operations).
    #[serde(rename = "collection:write")]
    CollectionWrite,
    /// Irreversible removal from the collection. Always also needs an explicit
    /// `confirm` argument on the call itself.
    #[serde(rename = "collection:delete")]
    CollectionDelete,
    /// Read statistics, insights, timeline, activity and achievements.
    #[serde(rename = "stats:read")]
    StatsRead,
    /// Read other collectors' *public* profiles and comparisons.
    #[serde(rename = "social:read")]
    SocialRead,
    /// Semantic / appearance search (needs the embedding worker).
    #[serde(rename = "search:ai")]
    SearchAi,
}

impl Scope {
    pub const ALL: &'static [Scope] = &[
        Scope::CatalogueRead,
        Scope::CatalogueWrite,
        Scope::CollectionRead,
        Scope::CollectionWrite,
        Scope::CollectionDelete,
        Scope::StatsRead,
        Scope::SocialRead,
        Scope::SearchAi,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Scope::CatalogueRead => "catalogue:read",
            Scope::CatalogueWrite => "catalogue:write",
            Scope::CollectionRead => "collection:read",
            Scope::CollectionWrite => "collection:write",
            Scope::CollectionDelete => "collection:delete",
            Scope::StatsRead => "stats:read",
            Scope::SocialRead => "social:read",
            Scope::SearchAi => "search:ai",
        }
    }
}

impl FromStr for Scope {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Scope::ALL
            .iter()
            .copied()
            .find(|c| c.as_str() == s)
            .ok_or(())
    }
}

/// The set of scopes a key carries. Ordered + deduplicated, so what we store,
/// return and log is stable regardless of the order the client sent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScopeSet(BTreeSet<Scope>);

impl ScopeSet {
    /// Parse a client-supplied list. An unknown scope is rejected rather than
    /// silently dropped — a typo must not quietly grant less than the user
    /// believes they granted.
    pub fn parse(values: &[String]) -> AppResult<Self> {
        let mut set = BTreeSet::new();
        for raw in values {
            let scope = raw
                .trim()
                .parse::<Scope>()
                .map_err(|()| AppError::BadRequest("unknown scope"))?;
            set.insert(scope);
        }
        if set.is_empty() {
            return Err(AppError::BadRequest("at least one scope is required"));
        }
        Ok(Self(set))
    }

    /// Rebuild from the stored `TEXT[]`. Unknown entries are skipped here (not
    /// rejected): a scope removed in a future build must degrade to "not
    /// granted", never to a hard failure that locks the user out of their own
    /// key list.
    fn from_db(values: &[String]) -> Self {
        Self(values.iter().filter_map(|v| v.parse().ok()).collect())
    }

    pub fn allows(&self, scope: Scope) -> bool {
        self.0.contains(&scope)
    }

    pub fn to_vec(&self) -> Vec<String> {
        self.0.iter().map(|s| s.as_str().to_string()).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

// ---------------------------------------------------------------- rows

/// A key as its owner sees it. Carries no secret and no hash.
#[derive(Debug, Clone, Serialize)]
pub struct ApiKey {
    pub id: Uuid,
    pub name: String,
    /// The public half of the token, so the UI can match a key to a client.
    pub prefix: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct ApiKeyRow {
    id: Uuid,
    name: String,
    prefix: String,
    scopes: Vec<String>,
    expires_at: Option<DateTime<Utc>>,
    last_used_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl From<ApiKeyRow> for ApiKey {
    fn from(r: ApiKeyRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            prefix: r.prefix,
            scopes: ScopeSet::from_db(&r.scopes).to_vec(),
            expires_at: r.expires_at,
            last_used_at: r.last_used_at,
            created_at: r.created_at,
        }
    }
}

/// What a successful token lookup yields: who, which key, and what it may do.
#[derive(Debug, Clone)]
pub struct ResolvedKey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub scopes: ScopeSet,
}

// ---------------------------------------------------------------- minting

fn sha256_hex(input: &str) -> String {
    use std::fmt::Write as _;
    let digest = Sha256::digest(input.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        // Infallible on String.
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Mint a key and return `(row, plaintext token)`. The plaintext is the only
/// time the secret exists outside the client — nothing persists it.
pub async fn mint(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    scopes: &ScopeSet,
    expires_at: Option<DateTime<Utc>>,
) -> AppResult<(ApiKey, String)> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    if name.chars().count() > 80 {
        return Err(AppError::BadRequest("name too long (max 80)"));
    }
    if scopes.is_empty() {
        return Err(AppError::BadRequest("at least one scope is required"));
    }
    if let Some(exp) = expires_at {
        let now = Utc::now();
        if exp <= now {
            return Err(AppError::BadRequest("expires_at must be in the future"));
        }
        if exp > now + chrono::Duration::days(MAX_LIFETIME_DAYS) {
            return Err(AppError::BadRequest("expires_at too far in the future"));
        }
    }

    let live: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    if live >= MAX_KEYS_PER_USER {
        return Err(AppError::Conflict("too many active API keys"));
    }

    let scope_list = scopes.to_vec();
    // 64 bits of prefix collides with vanishing probability; retry rather than
    // surface a 500 from the unique index.
    for _ in 0..5 {
        let prefix = mint_token()[..PREFIX_LEN].to_string();
        let secret = format!("{}{}", mint_token(), mint_token());
        debug_assert_eq!(secret.len(), SECRET_LEN);
        let row: Result<ApiKeyRow, sqlx::Error> = sqlx::query_as(
            "INSERT INTO api_keys (id, user_id, name, prefix, secret_hash, scopes, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, prefix, scopes, expires_at, last_used_at, created_at",
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(name)
        .bind(&prefix)
        .bind(sha256_hex(&secret))
        .bind(&scope_list)
        .bind(expires_at)
        .fetch_one(pool)
        .await;

        match row {
            Ok(row) => {
                let token = format!("{TOKEN_MARKER}{prefix}_{secret}");
                return Ok((row.into(), token));
            }
            Err(sqlx::Error::Database(db)) if db.is_unique_violation() => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "could not mint a unique api key prefix"
    )))
}

/// Split a presented token into `(prefix, secret)`, or `None` if it isn't
/// shaped like one of ours. Purely syntactic — no DB access, so a malformed
/// header costs nothing.
fn parse_token(token: &str) -> Option<(&str, &str)> {
    let rest = token.strip_prefix(TOKEN_MARKER)?;
    let (prefix, secret) = rest.split_once('_')?;
    let ok = prefix.len() == PREFIX_LEN
        && secret.len() == SECRET_LEN
        && prefix.bytes().all(|b| b.is_ascii_hexdigit())
        && secret.bytes().all(|b| b.is_ascii_hexdigit());
    ok.then_some((prefix, secret))
}

type ResolveRow = (
    Uuid,
    Uuid,
    String,
    Vec<String>,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
);

/// Resolve a presented token. `None` covers every rejection reason —
/// malformed, unknown, revoked, expired, wrong secret — so a caller cannot
/// tell them apart and use the endpoint as an oracle.
pub async fn resolve(pool: &PgPool, token: &str) -> AppResult<Option<ResolvedKey>> {
    let Some((prefix, secret)) = parse_token(token) else {
        return Ok(None);
    };

    let row: Option<ResolveRow> = sqlx::query_as(
        "SELECT id, user_id, secret_hash, scopes, expires_at, revoked_at
         FROM api_keys WHERE prefix = $1",
    )
    .bind(prefix)
    .fetch_optional(pool)
    .await?;

    let Some((id, user_id, secret_hash, scopes, expires_at, revoked_at)) = row else {
        return Ok(None);
    };

    // Hash and compare even for a row we already know we'll reject (revoked,
    // expired), so those paths stay indistinguishable from a wrong secret.
    //
    // An *absent* prefix does return earlier, without hashing — so the timing
    // does reveal whether a given 64-bit prefix exists. That's acceptable: the
    // prefix is deliberately public (it's shown in the owner's UI), and knowing
    // one is worthless without the independent 256-bit secret.
    let secret_ok =
        crate::auth::constant_time_eq(sha256_hex(secret).as_bytes(), secret_hash.as_bytes());
    let live = revoked_at.is_none() && expires_at.is_none_or(|exp| exp > Utc::now());
    if !(secret_ok && live) {
        return Ok(None);
    }

    Ok(Some(ResolvedKey {
        id,
        user_id,
        scopes: ScopeSet::from_db(&scopes),
    }))
}

/// Stamp `last_used_at`, at most once every five minutes per key. Without the
/// guard every MCP request would be a write, turning a read-only agent into a
/// steady stream of row updates.
pub async fn touch_last_used(pool: &PgPool, key_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE api_keys SET last_used_at = now()
         WHERE id = $1
           AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')",
    )
    .bind(key_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------- management

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<ApiKey>> {
    let rows: Vec<ApiKeyRow> = sqlx::query_as(
        "SELECT id, name, prefix, scopes, expires_at, last_used_at, created_at
         FROM api_keys
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Revoke by stamping rather than deleting, so `mcp_audit_log.api_key_id`
/// stays resolvable and the trail keeps naming the key that acted.
pub async fn revoke(pool: &PgPool, user_id: Uuid, key_id: Uuid) -> AppResult<()> {
    let res = sqlx::query(
        "UPDATE api_keys SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(key_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// ---------------------------------------------------------------- audit

/// How a tool call ended, as recorded in the trail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    /// Refused before doing anything: missing scope, or a destructive call
    /// without `confirm`.
    Denied,
    Error,
}

impl Outcome {
    fn as_str(self) -> &'static str {
        match self {
            Outcome::Ok => "ok",
            Outcome::Denied => "denied",
            Outcome::Error => "error",
        }
    }
}

/// One audit row as the owner sees it.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AuditEntry {
    pub at: DateTime<Utc>,
    pub tool: String,
    pub outcome: String,
    pub duration_ms: Option<i32>,
    pub target_id: Option<Uuid>,
    pub detail: Option<String>,
    /// Name of the key that made the call.
    pub key_name: Option<String>,
}

/// Digest of a tool's arguments, for correlating repeated calls without
/// storing their content: arguments carry prices, private notes and shop
/// names, and the trail is read back into the owner's own UI.
pub fn args_digest(args: &serde_json::Value) -> String {
    sha256_hex(&args.to_string())[..32].to_string()
}

#[allow(clippy::too_many_arguments)]
pub async fn log_call(
    pool: &PgPool,
    user_id: Uuid,
    key_id: Uuid,
    tool: &str,
    outcome: Outcome,
    duration_ms: Option<i32>,
    args_digest: Option<&str>,
    target_id: Option<Uuid>,
    detail: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO mcp_audit_log
             (id, user_id, api_key_id, tool, outcome, duration_ms, args_digest, target_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(key_id)
    .bind(tool)
    .bind(outcome.as_str())
    .bind(duration_ms)
    .bind(args_digest)
    .bind(target_id)
    .bind(detail)
    .execute(pool)
    .await?;

    // Opportunistic retention: roughly one call in 64 also trims this user's
    // old rows. Cheap (the index is `(user_id, at DESC)`), needs no cron, and
    // the trail is a convenience log — a few extra days of it harms nothing.
    if rand::random::<u8>().is_multiple_of(64) {
        let _ = sqlx::query(
            "DELETE FROM mcp_audit_log
             WHERE user_id = $1 AND at < now() - make_interval(days => $2)",
        )
        .bind(user_id)
        .bind(AUDIT_RETENTION_DAYS)
        .execute(pool)
        .await;
    }
    Ok(())
}

pub async fn recent_calls(pool: &PgPool, user_id: Uuid, limit: i64) -> AppResult<Vec<AuditEntry>> {
    let rows: Vec<AuditEntry> = sqlx::query_as(
        "SELECT l.at, l.tool, l.outcome, l.duration_ms, l.target_id, l.detail, k.name AS key_name
         FROM mcp_audit_log l
         LEFT JOIN api_keys k ON k.id = l.api_key_id
         WHERE l.user_id = $1
         ORDER BY l.at DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_round_trips_through_its_wire_name() {
        for scope in Scope::ALL {
            assert_eq!(scope.as_str().parse::<Scope>(), Ok(*scope));
        }
    }

    #[test]
    fn parse_rejects_unknown_scope_instead_of_dropping_it() {
        let ok = ScopeSet::parse(&["catalogue:read".into(), "stats:read".into()]).unwrap();
        assert!(ok.allows(Scope::CatalogueRead));
        assert!(ok.allows(Scope::StatsRead));
        assert!(!ok.allows(Scope::CatalogueWrite));

        assert!(ScopeSet::parse(&["catalogue:admin".into()]).is_err());
        assert!(
            ScopeSet::parse(&["catalogue:read ".into()]).is_ok(),
            "trimmed"
        );
        assert!(ScopeSet::parse(&[]).is_err(), "empty grants nothing");
    }

    #[test]
    fn stored_scopes_are_stable_and_deduplicated() {
        let set = ScopeSet::parse(&[
            "stats:read".into(),
            "catalogue:read".into(),
            "stats:read".into(),
        ])
        .unwrap();
        assert_eq!(set.to_vec(), vec!["catalogue:read", "stats:read"]);
    }

    #[test]
    fn unknown_stored_scope_degrades_to_not_granted() {
        let set = ScopeSet::from_db(&["catalogue:read".into(), "scope:from:the:future".into()]);
        assert!(set.allows(Scope::CatalogueRead));
        assert_eq!(set.to_vec(), vec!["catalogue:read"]);
    }

    #[test]
    fn token_parses_only_in_the_exact_expected_shape() {
        let prefix = "0123456789abcdef";
        let secret = "f".repeat(SECRET_LEN);
        let token = format!("{TOKEN_MARKER}{prefix}_{secret}");
        assert_eq!(parse_token(&token), Some((prefix, secret.as_str())));

        // Wrong marker, wrong lengths, non-hex, missing separator.
        assert!(parse_token(&format!("xx_{prefix}_{secret}")).is_none());
        assert!(parse_token(&format!("{TOKEN_MARKER}{prefix}_{}", "f".repeat(63))).is_none());
        assert!(parse_token(&format!("{TOKEN_MARKER}{}_{secret}", "0".repeat(15))).is_none());
        assert!(parse_token(&format!("{TOKEN_MARKER}{}_{secret}", "z".repeat(16))).is_none());
        assert!(parse_token(&format!("{TOKEN_MARKER}{prefix}{secret}")).is_none());
        assert!(parse_token("").is_none());
    }

    #[test]
    fn the_lifetime_ceiling_stays_inside_chronos_own_limits() {
        // `routes::mcp_keys` bounds-checks against this constant *before*
        // doing date arithmetic, because `chrono::Duration::days` panics past
        // ~9.5e7 days and this crate builds with `panic = "abort"`. If the
        // ceiling ever grew past what chrono accepts, that guard would stop
        // guarding.
        let d = chrono::Duration::try_days(MAX_LIFETIME_DAYS).expect("ceiling fits in a Duration");
        assert!(
            Utc::now().checked_add_signed(d).is_some(),
            "a key minted at the ceiling must not overflow the calendar"
        );
    }

    #[test]
    fn sha256_hex_is_the_known_digest() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
