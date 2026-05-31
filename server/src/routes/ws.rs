//! `/api/ws` — per-user WebSocket bridged to the in-process EventBus.

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, header},
    response::IntoResponse,
    routing::get,
};
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use tower_sessions::Session;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_handler))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    session: Session,
) -> AppResult<impl IntoResponse> {
    // Cross-Site WebSocket Hijacking guard. Browsers always send `Origin` on a
    // WS handshake, so when it's present it must match our own frontend origin;
    // a mismatch means a cross-site page is trying to ride the session cookie.
    // A missing header (non-browser clients) is allowed — the session cookie
    // still gates access via `require_user` below.
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !origin_allowed(origin.to_str().unwrap_or(""), &state.config.frontend_url) {
            return Err(AppError::Forbidden);
        }
    }

    let user_id = auth::require_user(&session).await?;
    let receiver = state.events.subscribe(user_id);
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, user_id, receiver)))
}

/// Compare the request `Origin` against the configured frontend URL by
/// scheme + host + port. Parsing both with `url::Url` normalizes default
/// ports (`https://host` == `https://host:443`); if either fails to parse we
/// fall back to a trimmed, case-insensitive string match.
fn origin_allowed(origin: &str, frontend_url: &str) -> bool {
    let origin = origin.trim();
    if origin.is_empty() {
        return false;
    }
    match (url::Url::parse(origin), url::Url::parse(frontend_url)) {
        (Ok(o), Ok(f)) => o.origin() == f.origin(),
        _ => origin.eq_ignore_ascii_case(frontend_url.trim().trim_end_matches('/')),
    }
}

async fn handle_socket(
    mut socket: WebSocket,
    user_id: Uuid,
    mut receiver: tokio::sync::broadcast::Receiver<Event>,
) {
    tracing::info!(user_id = %user_id, "websocket connection opened");

    // Hello frame so the client knows it's wired up.
    let hello = serde_json::json!({
        "type": "hello",
        "user_id": user_id,
    })
    .to_string();
    if socket.send(Message::Text(hello.into())).await.is_err() {
        return;
    }

    // Periodic ping to keep idle proxies happy.
    let mut ping_interval = tokio::time::interval(Duration::from_secs(25));
    ping_interval.tick().await; // skip the immediate first tick

    loop {
        tokio::select! {
            biased;

            // Inbound from the browser
            msg = socket.recv() => {
                match msg {
                    None | Some(Ok(Message::Close(_))) | Some(Err(_)) => break,
                    Some(Ok(Message::Ping(p))) => {
                        if socket.send(Message::Pong(p)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Pong(_))) | Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {
                        // Phase 2B: ignore inbound payloads.
                    }
                }
            }

            // Outbound from the EventBus
            event = receiver.recv() => {
                match event {
                    Ok(ev) => {
                        let body = match serde_json::to_string(&ev) {
                            Ok(s) => s,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(body.into())).await.is_err() { break; }
                    }
                    Err(RecvError::Lagged(skipped)) => {
                        tracing::warn!(user_id = %user_id, skipped, "websocket lagged; sending resync");
                        let resync = serde_json::json!({"type":"resync"}).to_string();
                        if socket.send(Message::Text(resync.into())).await.is_err() { break; }
                    }
                    Err(RecvError::Closed) => break,
                }
            }

            _ = ping_interval.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            }
        }
    }

    tracing::info!(user_id = %user_id, "websocket connection closed");
}
