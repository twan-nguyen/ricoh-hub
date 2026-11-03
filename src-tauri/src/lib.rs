use tauri::Manager;

mod printer_ipp;
mod printing;
mod scanning;
mod settings;
mod snapshot;
mod snmp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(settings::Settings::load(app.path().app_config_dir()?));
            Ok(())
        })
        .manage(scanning::ActiveScan::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            snapshot::get_snapshot,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
