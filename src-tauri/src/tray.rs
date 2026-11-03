use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Manager,
    image::Image,
    include_image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
};

use crate::monitor::{Monitor, Status};

/// Template images: macOS draws them in the menu bar's own colour, light or dark,
/// so state is told by shape (a badge, a faded printer) rather than by colour.
const OK: Image<'static> = include_image!("icons/tray/ok.png");
const WARNING: Image<'static> = include_image!("icons/tray/warning.png");
const ERROR: Image<'static> = include_image!("icons/tray/error.png");
const OFFLINE: Image<'static> = include_image!("icons/tray/offline.png");

#[derive(Clone, Copy, PartialEq, Debug)]
enum Look {
    Ok,
    Warning,
    Error,
    Offline,
}

impl Look {
    fn image(self) -> Image<'static> {
        match self {
            Look::Ok => OK,
            Look::Warning => WARNING,
            Look::Error => ERROR,
            Look::Offline => OFFLINE,
        }
    }
}

pub struct Tray {
    icon: TrayIcon,
    /// First line of the menu, such as "Sẵn sàng · mực 20%".
    summary: MenuItem<tauri::Wry>,
    look: Mutex<Look>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let summary = MenuItem::with_id(app, "summary", "Đang đọc máy in…", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &summary,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Mở Ricoh Hub", true, None::<&str>)?,
            &MenuItem::with_id(app, "print", "In tài liệu…", true, None::<&str>)?,
            &MenuItem::with_id(app, "refresh", "Đọc lại máy in", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Thoát Ricoh Hub", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let icon = TrayIconBuilder::with_id("printer")
        .icon(OFFLINE)
        .icon_as_template(true)
        .tooltip("Ricoh Hub")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app),
            "print" => {
                show_window(app);
                let _ = app.emit_to("main", "navigate", "print");
            }
            "refresh" => app.state::<Monitor>().refresh(),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.manage(Tray {
        icon,
        summary,
        look: Mutex::new(Look::Offline),
    });
    Ok(())
}

pub fn show_status(app: &AppHandle, status: &Status) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let (look, text) = summary(status);
    let _ = tray.summary.set_text(&text);
    let _ = tray.icon.set_tooltip(Some(format!("Ricoh Hub · {text}")));
    let mut current = tray.look.lock().unwrap();
    if *current != look {
        *current = look;
        let _ = tray.icon.set_icon(Some(look.image()));
        let _ = tray.icon.set_icon_as_template(true);
    }
}

fn summary(status: &Status) -> (Look, String) {
    if status.error.is_some() {
        return (Look::Offline, "Không kết nối được máy in".into());
    }
    match &status.snapshot {
        Some(snapshot) => printer_summary(snapshot.state, &snapshot.reasons, snapshot.toner),
        None => (Look::Offline, "Đang đọc máy in…".into()),
    }
}

/// Counts reasons the way the window's issue list does: `-warning` warns,
/// `-report` is noise, and a reason without a suffix is an error (RFC 8011).
fn printer_summary(state: i32, reasons: &[String], toner: Option<i32>) -> (Look, String) {
    let label = match state {
        3 => "Sẵn sàng",
        4 => "Đang in",
        5 => "Đã dừng",
        _ => "Không rõ trạng thái",
    };
    let warnings = reasons.iter().filter(|r| r.ends_with("-warning")).count();
    let errors = reasons
        .iter()
        .filter(|r| !r.ends_with("-warning") && !r.ends_with("-report"))
        .count();

    let mut parts = vec![label.to_string()];
    if let Some(toner) = toner {
        parts.push(format!("mực {toner}%"));
    }
    if errors > 0 {
        parts.push(format!("{errors} lỗi"));
    }
    if warnings > 0 {
        parts.push(format!("{warnings} cảnh báo"));
    }

    let look = if errors > 0 || state == 5 {
        Look::Error
    } else if warnings > 0 {
        Look::Warning
    } else {
        Look::Ok
    };
    (look, parts.join(" · "))
}

/// Brings the window back, with its Dock icon.
pub fn show_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    // Numbers read up to a minute ago while hidden should not greet the user.
    app.state::<Monitor>().refresh();
}

/// Closing the window keeps the app in the menu bar; only Quit ends it.
pub fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reasons(list: &[&str]) -> Vec<String> {
        list.iter().map(|r| r.to_string()).collect()
    }

    #[test]
    fn idle_printer_reads_ready_with_toner() {
        assert_eq!(
            printer_summary(3, &[], Some(20)),
            (Look::Ok, "Sẵn sàng · mực 20%".into())
        );
    }

    #[test]
    fn warnings_badge_the_icon_and_reports_are_ignored() {
        let (look, text) = printer_summary(
            3,
            &reasons(&["media-low-warning", "toner-low-report"]),
            Some(10),
        );
        assert_eq!(look, Look::Warning);
        assert_eq!(text, "Sẵn sàng · mực 10% · 1 cảnh báo");
    }

    #[test]
    fn a_reason_without_suffix_is_an_error() {
        let (look, text) = printer_summary(4, &reasons(&["media-jam", "media-low-warning"]), None);
        assert_eq!(look, Look::Error);
        assert_eq!(text, "Đang in · 1 lỗi · 1 cảnh báo");
    }

    #[test]
    fn stopped_printer_is_an_error_even_without_reasons() {
        assert_eq!(printer_summary(5, &[], None).0, Look::Error);
    }

    #[test]
    fn unreachable_printer_fades_the_icon() {
        let status = Status {
            error: Some("timeout".into()),
            ..Status::default()
        };
        assert_eq!(summary(&status).0, Look::Offline);
    }
}
