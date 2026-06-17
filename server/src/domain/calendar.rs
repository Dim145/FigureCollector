//! Pre-order calendar feed — a per-user iCal (.ics) subscription.
//!
//! `users.calendar_token` is an unguessable secret carried in the public feed
//! URL (`/api/calendar/<token>/preorders.ics`); a calendar app polls it with no
//! session. We mint the token lazily on first request, expose a rotate to
//! revoke a leaked link, and render the user's pre-orders as all-day VEVENTs
//! keyed on each one's current release date.

use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::gift::mint_token;
use crate::domain::preorder::{self, PreorderWithFigure};
use crate::error::{AppError, AppResult};

/// The user's calendar token, or `None` if one was never minted.
pub async fn calendar_token(pool: &PgPool, user_id: Uuid) -> AppResult<Option<String>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT calendar_token FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

/// Return the user's calendar token, minting one on first call. Idempotent.
pub async fn ensure_calendar_token(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    if let Some(tok) = calendar_token(pool, user_id).await? {
        return Ok(tok);
    }
    set_token(pool, user_id, true).await
}

/// Replace the token with a fresh one, revoking any previously-shared URL.
pub async fn rotate_calendar_token(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    set_token(pool, user_id, false).await
}

/// Mint + store a token, retrying on the vanishingly rare unique collision.
/// `only_if_absent` guards the lazy-create path against a concurrent mint
/// (sets only while still NULL); rotate overwrites unconditionally.
async fn set_token(pool: &PgPool, user_id: Uuid, only_if_absent: bool) -> AppResult<String> {
    for _ in 0..5 {
        let tok = mint_token();
        let q = if only_if_absent {
            sqlx::query(
                "UPDATE users SET calendar_token = $1 WHERE id = $2 AND calendar_token IS NULL",
            )
        } else {
            sqlx::query("UPDATE users SET calendar_token = $1 WHERE id = $2")
        };
        let res = q.bind(&tok).bind(user_id).execute(pool).await;
        match res {
            Ok(r) if r.rows_affected() == 1 => return Ok(tok),
            // 0 rows on the only_if_absent path ⇒ a token already exists
            // (concurrent create); re-read and return it.
            Ok(_) => return calendar_token(pool, user_id).await?.ok_or(AppError::NotFound),
            Err(sqlx::Error::Database(db)) if db.is_unique_violation() => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "could not allocate a unique calendar token"
    )))
}

/// Render the user's pre-orders as a VCALENDAR document. `calendar_name` is the
/// human label calendar apps show for the subscription.
pub async fn preorders_ics(
    pool: &PgPool,
    user_id: Uuid,
    calendar_name: &str,
) -> AppResult<String> {
    let preorders = preorder::list_for_user(pool, user_id).await?;
    Ok(render_ics(calendar_name, &preorders))
}

fn render_ics(calendar_name: &str, preorders: &[PreorderWithFigure]) -> String {
    let mut out = String::new();
    out.push_str("BEGIN:VCALENDAR\r\n");
    out.push_str("VERSION:2.0\r\n");
    out.push_str("PRODID:-//FigureCollector//Preorders//EN\r\n");
    out.push_str("CALSCALE:GREGORIAN\r\n");
    out.push_str("METHOD:PUBLISH\r\n");
    push_folded(&mut out, "X-WR-CALNAME", calendar_name);
    out.push_str("X-WR-TIMEZONE:UTC\r\n");

    for p in preorders {
        // Skip pre-orders with no place on a calendar: no date, or cancelled.
        let Some(date) = p.release_date_current else {
            continue;
        };
        if p.status == "cancelled" {
            continue;
        }
        out.push_str("BEGIN:VEVENT\r\n");
        push_folded(&mut out, "UID", &format!("preorder-{}@figurecollector", p.id));
        // Stable DTSTAMP from created_at so a re-fetch doesn't churn the event.
        out.push_str(&format!(
            "DTSTAMP:{}\r\n",
            p.created_at.format("%Y%m%dT%H%M%SZ")
        ));
        // All-day event on the release date (DATE value — no time-of-day).
        out.push_str(&format!("DTSTART;VALUE=DATE:{}\r\n", date.format("%Y%m%d")));
        push_folded(&mut out, "SUMMARY", &event_summary(p));
        let desc = event_description(p);
        if !desc.is_empty() {
            push_folded(&mut out, "DESCRIPTION", &desc);
        }
        if let Some(url) = p.tracking_url.as_deref().filter(|u| !u.is_empty()) {
            push_folded(&mut out, "URL", url);
        }
        out.push_str("END:VEVENT\r\n");
    }

    out.push_str("END:VCALENDAR\r\n");
    out
}

/// Event title: the figure, plus its manufacturer when known.
fn event_summary(p: &PreorderWithFigure) -> String {
    match p.manufacturer_name.as_deref().filter(|m| !m.is_empty()) {
        Some(m) => format!("{} — {}", p.figure_name, m),
        None => p.figure_name.clone(),
    }
}

/// Event body: store, price, and the user's own notes (locale-free — the feed
/// has no session/locale; the figure + date carry the essential meaning).
fn event_description(p: &PreorderWithFigure) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(s) = p.store_name.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("Boutique : {s}"));
    }
    if let (Some(amount), Some(cur)) = (&p.price_amount, p.price_currency.as_deref()) {
        parts.push(format!("Prix : {amount} {cur}"));
    }
    if let Some(n) = p.notes.as_deref().filter(|n| !n.is_empty()) {
        parts.push(n.to_string());
    }
    parts.join("\n")
}

/// Escape a text value per RFC 5545 §3.3.11 (backslash, semicolon, comma, and
/// newline; bare CR dropped).
fn escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            _ => out.push(c),
        }
    }
    out
}

/// Append a `NAME:value` content line: escape the value, then fold to ≤75
/// octets with CRLF + single-space continuation (RFC 5545 §3.1), never
/// splitting a multi-byte UTF-8 char.
fn push_folded(out: &mut String, name: &str, value: &str) {
    let line = format!("{name}:{}", escape_text(value));
    if line.len() <= 75 {
        out.push_str(&line);
        out.push_str("\r\n");
        return;
    }
    let mut start = 0;
    let mut first = true;
    while start < line.len() {
        // A continuation line spends one of its 75 octets on the leading space.
        let budget = if first { 75 } else { 74 };
        let mut end = (start + budget).min(line.len());
        while end > start && !line.is_char_boundary(end) {
            end -= 1;
        }
        if !first {
            out.push(' ');
        }
        out.push_str(&line[start..end]);
        out.push_str("\r\n");
        start = end;
        first = false;
    }
}
