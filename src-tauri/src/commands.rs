use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Serialize;
use shiori_core::{
    BookmarkColor, ColorAdjustments, CoreError, LibraryListing, LibraryService, NewBookmark,
    PlaybackSession, Progress, VideoEntry,
};
use tauri::{AppHandle, Manager, State};

pub type Service = Arc<LibraryService>;
pub struct ExitState(pub AtomicBool);
pub struct StartupPaths(pub Mutex<Vec<String>>);

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        let code = match &error {
            CoreError::SourceUnavailable => "sourceUnavailable",
            CoreError::ContentChanged => "contentChanged",
            _ => "operationFailed",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> shiori_core::Result<T> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| CommandError {
            code: "operationFailed",
            message: "処理を完了できませんでした。もう一度お試しください。".into(),
        })?
        .map_err(Into::into)
}

fn scope_error(error: tauri::Error) -> CommandError {
    CommandError {
        code: "operationFailed",
        message: error.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    thumbnail_directory: PathBuf,
    is_development: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle, service: State<'_, Service>) -> AppInfo {
    AppInfo {
        thumbnail_directory: service.thumbnail_directory(),
        is_development: app.config().identifier.ends_with(".dev"),
    }
}

#[tauri::command]
pub async fn list_videos(service: State<'_, Service>) -> Result<LibraryListing, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.list()).await
}

#[tauri::command]
pub async fn import_video(
    service: State<'_, Service>,
    path: String,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.import(std::path::Path::new(&path))).await
}

#[tauri::command]
pub async fn open_video(
    app: AppHandle,
    service: State<'_, Service>,
    id: String,
) -> Result<PlaybackSession, CommandError> {
    let service = service.inner().clone();
    let session = blocking(move || service.open(&id)).await?;
    app.asset_protocol_scope()
        .allow_file(&session.video.video.path)
        .map_err(scope_error)?;
    Ok(session)
}

#[tauri::command]
pub async fn relink_video(
    service: State<'_, Service>,
    id: String,
    path: String,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.relink(&id, std::path::Path::new(&path))).await
}

#[tauri::command]
pub async fn save_progress(
    service: State<'_, Service>,
    session_id: String,
    revision: u64,
    progress: Progress,
) -> Result<(), CommandError> {
    let service = service.inner().clone();
    blocking(move || service.save_progress(&session_id, revision, progress)).await
}

#[tauri::command]
pub async fn add_bookmark(
    service: State<'_, Service>,
    id: String,
    input: NewBookmark,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.add_bookmark(&id, input)).await
}

#[tauri::command]
pub async fn edit_bookmark(
    service: State<'_, Service>,
    id: String,
    bookmark_id: String,
    note: String,
    color: BookmarkColor,
    end_seconds: Option<f64>,
    color_adjustments: Option<ColorAdjustments>,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || {
        service.edit_bookmark(
            &id,
            &bookmark_id,
            &note,
            color,
            end_seconds,
            color_adjustments,
        )
    })
    .await
}

#[tauri::command]
pub async fn remove_bookmark(
    service: State<'_, Service>,
    id: String,
    bookmark_id: String,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.remove_bookmark(&id, &bookmark_id)).await
}

#[tauri::command]
pub async fn save_cover(
    service: State<'_, Service>,
    id: String,
    data_url: String,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.save_cover(&id, &data_url)).await
}

#[tauri::command]
pub async fn rename_video(
    service: State<'_, Service>,
    id: String,
    title: String,
) -> Result<VideoEntry, CommandError> {
    let service = service.inner().clone();
    blocking(move || service.rename(&id, &title)).await
}

#[tauri::command]
pub async fn remove_video(service: State<'_, Service>, id: String) -> Result<(), CommandError> {
    let service = service.inner().clone();
    blocking(move || service.remove(&id)).await
}

#[tauri::command]
pub fn take_startup_paths(paths: State<'_, StartupPaths>) -> Result<Vec<String>, CommandError> {
    let mut paths = paths
        .0
        .lock()
        .map_err(|_| CommandError::from(CoreError::Lock))?;
    Ok(std::mem::take(&mut *paths))
}

#[tauri::command]
pub fn finish_quit(app: AppHandle, state: State<'_, ExitState>) {
    state.0.store(true, Ordering::SeqCst);
    app.exit(0);
}
