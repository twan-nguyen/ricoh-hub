use tauri::Manager;

mod printer_ipp;
mod printing;
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
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            snapshot::get_snapshot,
            printing::print_file,
            printing::cancel_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
