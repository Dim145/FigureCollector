//! `/api/admin/*` — staff-only endpoints, gated by `auth::require_admin`.

use crate::auth;
use crate::auth::user::User;
use crate::domain::admin::{self, NewAdminUser, UserPatch};
use crate::domain::figure;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

// ---------- /admin/overview --------------------------------------------------

async fn overview(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<admin::AdminOverview>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(admin::overview(&state.pool).await?))
}

// ---------- /admin/users -----------------------------------------------------

async fn list_users(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<admin::AdminUserRow>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(admin::list_users(&state.pool).await?))
}

async fn create_user(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewAdminUser>,
) -> AppResult<(StatusCode, Json<User>)> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let user = admin::create_user(&state.pool, input).await?;
    tracing::info!(
        new_user = %user.id, by_admin = %actor.id, is_admin = user.is_admin,
        "admin created user",
    );
    Ok((StatusCode::CREATED, Json(user)))
}

async fn patch_user(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<UserPatch>,
) -> AppResult<Json<User>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    // Last-admin guard: refuse to demote the only remaining admin.
    if matches!(input.is_admin, Some(false)) {
        let overview = admin::overview(&state.pool).await?;
        let target_currently_admin =
            crate::auth::user::find_by_id(&state.pool, id).await?
                .is_some_and(|u| u.is_admin);
        if overview.admin_count <= 1 && target_currently_admin {
            return Err(AppError::BadRequest("cannot demote the last admin"));
        }
    }
    let user = admin::patch_user(&state.pool, id, input).await?;
    tracing::info!(target = %user.id, by_admin = %actor.id, "admin updated user");
    Ok(Json(user))
}

async fn delete_user(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    if actor.id == id {
        return Err(AppError::BadRequest("cannot delete your own account"));
    }
    // Refuse to wipe the last admin (would lock everyone out of /admin).
    let overview = admin::overview(&state.pool).await?;
    let target = crate::auth::user::find_by_id(&state.pool, id).await?;
    if let Some(t) = &target {
        if t.is_admin && overview.admin_count <= 1 {
            return Err(AppError::BadRequest("cannot delete the last admin"));
        }
    } else {
        return Err(AppError::NotFound);
    }
    admin::delete_user(&state.pool, id).await?;
    tracing::info!(target = %id, by_admin = %actor.id, "admin deleted user");
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/figures ---------------------------------------------------

#[derive(Deserialize)]
struct ListFiguresQuery {
    q: Option<String>,
    figure_type: Option<String>,
    manufacturer: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn list_figures(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ListFiguresQuery>,
) -> AppResult<Json<Vec<figure::Figure>>> {
    auth::require_admin(&session, &state.pool).await?;
    // `figure::list` already returns the full catalog; admins just see more
    // because they aren't blocked by the user-creator visibility filter.
    let params = figure::ListQuery {
        q: q.q,
        figure_type: q.figure_type,
        manufacturer: q.manufacturer,
        limit: q.limit.or(Some(200)),
        offset: q.offset,
    };
    Ok(Json(figure::list(&state.pool, params).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/overview", get(overview))
        .route("/admin/users", get(list_users).post(create_user))
        .route(
            "/admin/users/{id}",
            axum::routing::patch(patch_user).delete(delete_user),
        )
        .route("/admin/figures", get(list_figures))
}
