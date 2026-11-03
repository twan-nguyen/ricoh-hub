use std::{sync::Mutex, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

use crate::{
    history::History,
    notifications::Tracker,
    settings::{PrinterSettings, Settings},
    snapshot::{self, Snapshot},
    tray,
};

/// How often the printer is read while the window is open.
const VISIBLE_EVERY: Duration = Duration::from_secs(10);
/// Hidden in the menu bar, reads are spaced out so the printer can still fall into Energy Saver.
const HIDDEN_EVERY: Duration = Duration::from_secs(60);

/// What the app knows about the printer; sent to the window as `printer-status` on every change.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The last good reading; it stays while the printer cannot be reached.
    pub snapshot: Option<Snapshot>,
    /// When `snapshot` was read, in milliseconds since the epoch.
    pub updated_at: Option<i64>,
    /// Why the last reading failed.
    pub error: Option<String>,
    pub reading: bool,
}

/// Reads the printer on a timer whether or not the window is open, so the menu bar icon stays current.
#[derive(Default)]
pub struct Monitor {
    status: Mutex<Status>,
    wake: Notify,
    tracker: Mutex<Tracker>,
}

impl Monitor {
    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    /// Reads now instead of at the next tick. A printer waking from Energy Saver
    /// can be slow, so a read already under way is left to finish rather than stacked.
    pub fn refresh(&self) {
        if !self.status.lock().unwrap().reading {
            self.wake.notify_one();
        }
    }

    /// Numbers from the old address must not pass for the new printer's.
    pub fn reset(&self, app: &AppHandle) {
        self.update(app, |s| {
            *s = Status {
                reading: s.reading,
                ..Status::default()
            }
        });
        // The new printer's problems are news; the old printer's are not.
        *self.tracker.lock().unwrap() = Tracker::default();
        self.refresh();
    }

    fn update(&self, app: &AppHandle, change: impl FnOnce(&mut Status)) {
        let status = {
            let mut status = self.status.lock().unwrap();
            change(&mut status);
            status.clone()
        };
        tray::show_status(app, &status);
        let _ = app.emit("printer-status", &status);
    }
}

fn same_printer(a: &PrinterSettings, b: &PrinterSettings) -> bool {
    a.host == b.host && a.community == b.community
}

fn window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Runs for the life of the app.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let monitor = app.state::<Monitor>();
        loop {
            let settings = app.state::<Settings>().get();
            monitor.update(&app, |s| s.reading = true);
            let result = snapshot::read_snapshot(settings.clone()).await;

            if same_printer(&settings, &app.state::<Settings>().get()) {
                if let Ok(snapshot) = &result
                    && let Err(error) = app.state::<History>().record(&settings.host, snapshot)
                {
                    eprintln!("Không ghi được lịch sử: {error}");
                }
                let notices = monitor.tracker.lock().unwrap().observe(result.as_ref().map_err(String::as_str));
                monitor.update(&app, |s| {
                    s.reading = false;
                    match result {
                        Ok(snapshot) => {
                            s.snapshot = Some(snapshot);
                            s.updated_at = Some(jiff::Timestamp::now().as_millisecond());
                            s.error = None;
                        }
                        Err(error) => s.error = Some(error),
                    }
                });
                let title = monitor.status().snapshot.and_then(|s| s.model).unwrap_or_else(|| "Ricoh Hub".into());
                for notice in notices.into_iter().filter(|n| n.kind.wanted(&settings.notify)) {
                    let _ = app.notification().builder().title(&title).body(notice.text).show();
                }
            } else {
                // The address changed mid-read; this reading belongs to the old printer.
                monitor.update(&app, |s| s.reading = false);
            }

            let every = if window_visible(&app) {
                VISIBLE_EVERY
            } else {
                HIDDEN_EVERY
            };
            tokio::select! {
                _ = tokio::time::sleep(every) => {}
                _ = monitor.wake.notified() => {}
            }
        }
    });
}

#[tauri::command]
pub fn get_status(monitor: State<'_, Monitor>) -> Status {
    monitor.status()
}

#[tauri::command]
pub fn refresh_printer(monitor: State<'_, Monitor>) {
    monitor.refresh();
}
