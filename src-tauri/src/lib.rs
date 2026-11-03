use tauri::{Manager, RunEvent, WindowEvent};

mod monitor;
mod printer_ipp;
mod printing;
mod scanning;
mod settings;
mod snapshot;
mod snmp;
mod tray;

/// Passed by the login item, so the app starts in the menu bar without a window.
const HIDDEN_ARG: &str = "--hidden";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(HIDDEN_ARG)
                .build(),
        )
        .setup(|app| {
            let settings = settings::Settings::load(app.path().app_config_dir()?);
            if let Err(error) =
                settings::apply_launch_at_login(app.handle(), settings.get().launch_at_login)
            {
                eprintln!("{error}");
            }
            app.manage(settings);
            tray::create(app.handle())?;
            monitor::start(app.handle().clone());
            if std::env::args().any(|arg| arg == HIDDEN_ARG) {
                tray::hide_window(app.handle());
            } else if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .manage(monitor::Monitor::default())
        .manage(scanning::ActiveScan::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                tray::hide_window(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            monitor::get_status,
            monitor::refresh_printer,
            printing::print_file,
            printing::cancel_job,
            scanning::get_scanner,
            scanning::get_scanner_status,
            scanning::get_scan_folder,
            scanning::start_scan,
            scanning::cancel_scan,
            scanning::open_scan,
            scanning::reveal_scan,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Clicking the app in Finder or Launchpad while it hides in the menu bar.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                tray::show_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
