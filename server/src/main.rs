use clap::Parser;
use std::net::SocketAddr;
use std::time::Duration;

mod auth;
mod config;
mod db;
mod domain;
mod entity;
mod error;
mod events;
mod external;
mod migration;
mod photo;
mod routes;
mod services;
mod state;
mod storage;

use crate::auth::oidc::OidcRegistry;
use crate::config::AppConfig;
use crate::events::EventBus;
use crate::state::AppState;
use crate::storage::Storage;

#[derive(Parser, Debug)]
#[command(
    name = "figurecollector-server",
    version,
    about = "FigureCollector backend — Rust/Axum API"
)]
struct Cli {
    #[arg(long)]
    health: bool,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if cli.health {
        let bind = std::env::var("FC_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
        return run_health_probe(&bind);
    }

    init_tracing();

    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .map_err(|_| {
            anyhow::anyhow!("failed to install aws-lc-rs as the default rustls crypto provider")
        })?;

    let config = AppConfig::from_env()?;

    let user_agent = concat!(
        "FigureCollector/",
        env!("CARGO_PKG_VERSION"),
        " (+https://github.com/Dim145/FigureCollector)"
    );
    // Same-host-only redirect policy. The orzgk / fx scrapers validate only
    // the INITIAL host they're handed, so a plain `limited(5)` would let a
    // hostile shop 30x us onto an arbitrary internal target (SSRF). We follow
    // a redirect ONLY when its host matches the immediately-previous URL's
    // host (covers the benign trailing-slash / http→https-upgrade cases) and
    // stop on any cross-host hop, capped at 5 in case of a same-host loop.
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let prev_host = attempt
                .previous()
                .last()
                .and_then(|u| u.host_str())
                .map(str::to_ascii_lowercase);
            let next_host = attempt.url().host_str().map(str::to_ascii_lowercase);
            if prev_host != next_host {
                // Cross-host redirect — refuse to follow (SSRF guard).
                attempt.stop()
            } else if attempt.previous().len() > 5 {
                attempt.error("too many same-host redirects")
            } else {
                attempt.follow()
            }
        }))
        .build()?;
    // Sibling client for outbound calls whose target URL is user-controlled
    // (webhook, ntfy server_url, apprise server_url). The SSRF guard in
    // `notify_channel::validate_outbound_url` blocks loopback / private
    // ranges on the initial URL — disabling redirects here means a hostile
    // upstream can't 302 us to an internal IP.
    let http_no_redirect = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    let oidc = OidcRegistry::build(
        &config.auth.oidc_providers,
        &config.auth.oidc_redirect_base,
        &http_client,
    )
    .await;

    let (pool, db) = db::connect_and_migrate(&config).await?;
    let session_layer = auth::sessions::build(&pool, config.cookie_secure).await?;
    let storage = Storage::from_env()?;
    let events = EventBus::new();

    // GC stale event channels every 5 min.
    {
        let bus = events.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(300));
            tick.tick().await;
            loop {
                tick.tick().await;
                let dropped = bus.gc();
                if dropped > 0 {
                    tracing::debug!(dropped, "event bus GC");
                }
            }
        });
    }

    let state = AppState {
        pool,
        db,
        config: config.clone(),
        oidc,
        http: http_client,
        http_no_redirect,
        storage,
        events,
    };

    // Daily release-date scheduler — fires J-day + J-7 notifications on
    // preorders that hit their release date.
    services::release_cron::spawn(state.clone());
    // Bridges Postgres NOTIFY (scan rows written directly by the gsplat
    // worker) to per-user WebSocket events so scans refresh live.
    services::scan_listener::spawn(state.clone());
    // Hourly purge of stale completed gsplat scans (keep N per figurine).
    services::scan_cleanup::spawn(state.clone());

    let app = routes::build_router(state).layer(session_layer);

    let addr: SocketAddr = config.bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(
        addr = %addr,
        version = env!("CARGO_PKG_VERSION"),
        "FigureCollector server listening"
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,figurecollector_server=debug".into()),
        )
        .json()
        .init();
}

fn run_health_probe(bind: &str) -> anyhow::Result<()> {
    use std::net::TcpStream;
    let probe_addr = bind
        .replace("0.0.0.0", "127.0.0.1")
        .replace("[::]", "[::1]");
    let parsed: SocketAddr = probe_addr.parse()?;
    match TcpStream::connect_timeout(&parsed, Duration::from_secs(2)) {
        Ok(_) => {
            eprintln!("health: ok ({parsed})");
            Ok(())
        }
        Err(e) => {
            eprintln!("health: fail ({parsed}): {e}");
            std::process::exit(1);
        }
    }
}

async fn shutdown_signal() {
    use tokio::signal;
    let ctrl_c = async {
        signal::ctrl_c().await.expect("install ctrl_c handler");
    };
    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
