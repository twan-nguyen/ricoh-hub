use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

/// Where the printer lives on the network. Kept in the app's config folder.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterSettings {
    pub host: String,
    pub community: String,
}

impl Default for PrinterSettings {
    /// The office IM 3500 this app was built for; `public` is the factory read-only community.
    fn default() -> Self {
        Self {
            host: "192.168.1.103".into(),
            community: "public".into(),
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
    host: String,
    community: String,
    settings: State<'_, Settings>,
) -> Result<PrinterSettings, String> {
    let next = PrinterSettings {
        host: host.trim().to_string(),
        community: community.trim().to_string(),
    };
    if next.host.is_empty() {
        return Err("Hãy nhập địa chỉ máy in.".into());
    }
    if next.community.is_empty() {
        return Err("Hãy nhập SNMP community.".into());
    }
    settings.save(next.clone())?;
    Ok(next)
}
