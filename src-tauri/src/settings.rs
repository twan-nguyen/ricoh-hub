use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{monitor::Monitor, notifications::NotifySettings};

/// Where the printer lives on the network. Kept in the app's config folder.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterSettings {
    pub host: String,
    pub community: String,
    /// Where scans are saved; none means Downloads/Ricoh Scans.
    #[serde(default)]
    pub scan_folder: Option<String>,
    /// Start hidden in the menu bar when the user logs in to the Mac.
    #[serde(default = "on")]
    pub launch_at_login: bool,
    #[serde(default)]
    pub notify: NotifySettings,
}

fn on() -> bool {
    true
}

impl Default for PrinterSettings {
    /// No printer until the user connects one; `public` is the factory read-only community.
    fn default() -> Self {
        Self {
            host: String::new(),
            community: "public".into(),
            scan_folder: None,
            launch_at_login: true,
            notify: NotifySettings::default(),
        }
    }
}

pub struct Settings {
    path: PathBuf,
    current: Mutex<PrinterSettings>,
}

impl Settings {
    /// Reads the saved settings; a missing or unreadable file falls back to the defaults.
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("settings.json");
        let current = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> PrinterSettings {
        self.current.lock().unwrap().clone()
    }

    fn save(&self, settings: PrinterSettings) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())?;
        *self.current.lock().unwrap() = settings;
        Ok(())
    }
}

#[tauri::command]
pub fn get_settings(settings: State<'_, Settings>) -> PrinterSettings {
    settings.get()
}

#[tauri::command]
pub fn save_settings(
    next: PrinterSettings,
    app: AppHandle,
    settings: State<'_, Settings>,
    monitor: State<'_, Monitor>,
) -> Result<PrinterSettings, String> {
    let next = PrinterSettings {
        host: next.host.trim().to_string(),
        community: next.community.trim().to_string(),
        scan_folder: next.scan_folder.map(|f| f.trim().to_string()).filter(|f| !f.is_empty()),
        launch_at_login: next.launch_at_login,
        notify: next.notify,
    };
    if next.host.is_empty() {
        return Err("Hãy nhập địa chỉ máy in.".into());
    }
    if next.community.is_empty() {
        return Err("Hãy nhập SNMP community.".into());
    }
    let previous = settings.get();
    apply_launch_at_login(&app, next.launch_at_login)?;
    settings.save(next.clone())?;
    if previous.host != next.host || previous.community != next.community {
        monitor.reset(&app);
    }
    Ok(next)
}

/// Forgets the printer's address, so the window asks for one again.
#[tauri::command]
pub fn disconnect_printer(
    app: AppHandle,
    settings: State<'_, Settings>,
    monitor: State<'_, Monitor>,
) -> Result<PrinterSettings, String> {
    let next = PrinterSettings {
        host: String::new(),
        ..settings.get()
    };
    settings.save(next.clone())?;
    monitor.reset(&app);
    Ok(next)
}

/// Adds or removes the login item to match the setting. Development builds leave it
/// alone: a login item pointing at the debug binary would open a window with no dev server behind it.
pub fn apply_launch_at_login(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let autolaunch = app.autolaunch();
    let result = match autolaunch.is_enabled() {
        Ok(current) if current == enabled => Ok(()),
        _ if enabled => autolaunch.enable(),
        _ => autolaunch.disable(),
    };
    result.map_err(|e| format!("Không đổi được chế độ mở khi đăng nhập: {e}"))
}
