mod commands;

use shiori_core::LibraryService;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Manager};

pub fn run() {
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
