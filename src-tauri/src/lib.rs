mod commands;

use shiori_core::LibraryService;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Manager};

pub fn run() {
    if let Err(error) = init_playback_log() {
        eprintln!("Shiori diagnostic log initialization failed: {error:?}");
    }
    let startup_paths = std::env::args_os()
        .skip(1)
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_file())
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::ExitState(AtomicBool::new(false)))
        .manage(commands::StartupPaths(Mutex::new(startup_paths)))
        .setup(|app| {
            let key = storage_environment_key(&app.config().identifier);
            let root = std::env::var_os(key)
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let service = LibraryService::new(root)?;
            app.asset_protocol_scope()
                .allow_directory(service.thumbnail_directory(), false)?;
            app.manage(Arc::new(service));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::list_videos,
            commands::import_video,
            commands::open_video,
            commands::relink_video,
            commands::save_progress,
            commands::add_bookmark,
            commands::edit_bookmark,
            commands::remove_bookmark,
            commands::save_cover,
            commands::rename_video,
            commands::remove_video,
            commands::take_startup_paths,
            commands::finish_quit,
            playback_diagnostics,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && !window
                    .state::<commands::ExitState>()
                    .0
                    .load(Ordering::SeqCst)
            {
                api.prevent_close();
                let _ = window.emit("request-quit", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("Shioriを起動できませんでした");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event
            && !app.state::<commands::ExitState>().0.load(Ordering::SeqCst)
        {
            api.prevent_exit();
            let _ = app.emit("request-quit", ());
        }
    });
}

fn storage_environment_key(identifier: &str) -> &'static str {
    if identifier == "local.kazuki.shiori.dev" {
        "SHIORI_DEV_DATA_DIR"
    } else {
        "SHIORI_DATA_DIR"
    }
}

// 一時診断コード。復帰点 f48956d。動画の配信・再生・保存処理は変更しない。
static PLAYBACK_LOG: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
struct DiagnosticLogger;
static DIAGNOSTIC_LOGGER: DiagnosticLogger = DiagnosticLogger;

impl log::Log for DiagnosticLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Warn
    }

    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            use std::io::Write;
            let _ = writeln!(std::io::stderr(), "[native {} {}] {}", record.level(), record.target(), record.args());
        }
    }

    fn flush(&self) {}
}

fn init_playback_log() -> std::io::Result<()> {
    use std::{io::Write, os::fd::AsRawFd, os::unix::fs::OpenOptionsExt};
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = std::env::temp_dir().join(format!("shiori-playback-{timestamp}-{}.log", std::process::id()));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;
    // このアプリ自身のstderrのみ。別プロセスや他アプリのシステムログは採取しない。
    if unsafe { libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO) } == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let _ = PLAYBACK_LOG.set(path.clone());
    let _ = log::set_logger(&DIAGNOSTIC_LOGGER);
    log::set_max_level(log::LevelFilter::Warn);
    let _ = writeln!(std::io::stderr(), "Shiori native playback diagnostics v4\ncheckpoint: f48956d\npid: {}\nstartedUnixMs: {timestamp}\nlogFile: {}\ntransport: Tauri 2.11.5 asset / instrumented Wry 0.55.1\nrangeLimitBytes: 8388608 (v3: 1024000)\n", std::process::id(), path.display());
    Ok(())
}

#[tauri::command]
fn playback_diagnostics(frontend: String) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom, Write};
    let path = PLAYBACK_LOG.get().ok_or("native log was not initialized")?;
    let _ = writeln!(std::io::stderr(), "\n[frontend playback error]\n{frontend}\n");
    let mut file = std::fs::File::open(path).map_err(|error| format!("{error:?}"))?;
    let length = file.metadata().map_err(|error| format!("{error:?}"))?.len();
    let start = length.saturating_sub(128 * 1024);
    file.seek(SeekFrom::Start(start)).map_err(|error| format!("{error:?}"))?;
    let mut bytes = Vec::new();
    file.take(128 * 1024).read_to_end(&mut bytes).map_err(|error| format!("{error:?}"))?;
    Ok(format!(
        "nativeLog.file: {}\nnativeLog.note: 実リクエストとこのアプリのstderr。別プロセスのWebKit内部ログは含まれません。ファイル名・パスは未加工です。\nnativeLog.truncated: {}\n\n{}",
        path.display(), start != 0, String::from_utf8_lossy(&bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_never_uses_the_production_storage_override() {
        assert_eq!(
            storage_environment_key("local.kazuki.shiori.dev"),
            "SHIORI_DEV_DATA_DIR"
        );
        assert_eq!(
            storage_environment_key("local.kazuki.shiori"),
            "SHIORI_DATA_DIR"
        );
    }
}
