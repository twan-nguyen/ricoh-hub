use serde::{Deserialize, Serialize};

use crate::snapshot::{Snapshot, Tray};

/// Failed reads in a row before the printer counts as lost; a printer waking from
/// Energy Saver, or a Mac waking from sleep, can miss one or two.
const OFFLINE_AFTER: u32 = 3;
/// Below this share of its capacity a tray reads as running low, as on the dashboard.
const LOW_PAPER_PERCENT: i64 = 15;
/// Toner at or below this level reads as running low, as on the dashboard.
const LOW_TONER_PERCENT: i32 = 10;

/// Which notifications the user wants; each can be turned off in Settings.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifySettings {
    pub paper: bool,
    pub toner: bool,
    /// Paper jams, and doors, covers or trays left open.
    pub jam: bool,
    pub connection: bool,
}

impl Default for NotifySettings {
    fn default() -> Self {
        Self { paper: true, toner: true, jam: true, connection: true }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Paper,
    Toner,
    Jam,
    Connection,
}

impl Kind {
    pub fn wanted(self, settings: &NotifySettings) -> bool {
        match self {
            Kind::Paper => settings.paper,
            Kind::Toner => settings.toner,
            Kind::Jam => settings.jam,
            Kind::Connection => settings.connection,
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct Notice {
    pub kind: Kind,
    pub text: String,
}

/// Something about the printer that needs a person.
#[derive(Debug)]
struct Problem {
    /// Tells the same problem apart between two readings, e.g. `paper-low:Tray 2`.
    key: String,
    kind: Kind,
    text: String,
    /// Said when the problem goes away. Only the problems that stop the printer
    /// get one; a tray going from low to full needs no news.
    solved: Option<String>,
}

fn problem(key: impl Into<String>, kind: Kind, text: impl Into<String>, solved: Option<&str>) -> Problem {
    Problem { key: key.into(), kind, text: text.into(), solved: solved.map(Into::into) }
}

/// "Tray 2" → "Khay 2".
fn tray_name(tray: &Tray) -> String {
    match tray.name.strip_prefix("Tray") {
        Some(number) => format!("Khay{number}"),
        None => tray.name.clone(),
    }
}

/// The same rules as the dashboard's tray, toner and waste cards (`src/lib/format.ts`).
fn problems(snapshot: &Snapshot) -> Vec<Problem> {
    let mut found = Vec::new();
    // The bypass tray is loaded by hand for one job, so empty is its resting state.
    for tray in snapshot.trays.iter().filter(|t| !t.manual && t.level >= 0) {
        let name = tray_name(tray);
        if tray.level == 0 || !tray.available {
            found.push(problem(
                format!("paper-empty:{}", tray.name),
                Kind::Paper,
                format!("{name} đã hết giấy"),
                Some(&format!("{name} đã có giấy")),
            ));
        } else if tray.capacity > 0 && tray.level * 100 <= tray.capacity * LOW_PAPER_PERCENT {
            found.push(problem(
                format!("paper-low:{}", tray.name),
                Kind::Paper,
                format!("{name} sắp hết giấy (còn {} tờ)", tray.level),
                None,
            ));
        }
    }

    let has = |names: &[&str]| snapshot.reasons.iter().any(|r| names.iter().any(|n| r.starts_with(n)));
    if has(&["toner-empty", "marker-supply-empty"]) {
        found.push(problem("toner-empty", Kind::Toner, "Hết mực", Some("Đã có mực trở lại")));
    } else if has(&["toner-low", "marker-supply-low"])
        || snapshot.toner.is_some_and(|t| t <= LOW_TONER_PERCENT)
    {
        let text = match snapshot.toner {
            Some(level) => format!("Mực sắp hết (còn {level}%)"),
            None => "Mực sắp hết".into(),
        };
        found.push(problem("toner-low", Kind::Toner, text, None));
    }
    if has(&["marker-waste-full"]) {
        found.push(problem(
            "waste-full",
            Kind::Toner,
            "Hộp mực thải đã đầy, cần thay",
            Some("Đã thay hộp mực thải"),
        ));
    } else if has(&["marker-waste-almost-full"]) {
        found.push(problem("waste-almost-full", Kind::Toner, "Hộp mực thải sắp đầy", None));
    }

    if has(&["media-jam"]) {
        found.push(problem("jam", Kind::Jam, "Kẹt giấy", Some("Đã hết kẹt giấy")));
    }
    if has(&["door-open", "cover-open"]) {
        found.push(problem("door-open", Kind::Jam, "Cửa máy đang mở", Some("Cửa máy đã đóng")));
    }
    if has(&["input-tray-missing"]) {
        found.push(problem(
            "tray-missing",
            Kind::Jam,
            "Một khay giấy đang mở hoặc chưa lắp",
            Some("Khay giấy đã đóng"),
        ));
    }
    found
}

/// Compares each reading with the one before, so a problem is told once when it
/// appears rather than on every reading while it lasts.
#[derive(Default)]
pub struct Tracker {
    /// None until the printer has been read once since the app started or the address changed.
    known: Option<Vec<Problem>>,
    failures: u32,
}

impl Tracker {
    pub fn observe(&mut self, reading: Result<&Snapshot, &str>) -> Vec<Notice> {
        let mut notices = Vec::new();
        let snapshot = match reading {
            Ok(snapshot) => snapshot,
            Err(_) => {
                self.failures += 1;
                // Only a printer that was reached can be lost; a Mac away from the office stays quiet.
                if self.failures == OFFLINE_AFTER && self.known.is_some() {
                    notices.push(Notice { kind: Kind::Connection, text: "Mất kết nối với máy in".into() });
                }
                return notices;
            }
        };

        if self.failures >= OFFLINE_AFTER && self.known.is_some() {
            notices.push(Notice { kind: Kind::Connection, text: "Đã kết nối lại với máy in".into() });
        }
        self.failures = 0;

        let now = problems(snapshot);
        match &self.known {
            // At launch, warnings the user has likely seen before are not repeated;
            // only what stops the printer is worth a notification.
            None => notices.extend(
                now.iter()
                    .filter(|p| p.solved.is_some())
                    .map(|p| Notice { kind: p.kind, text: p.text.clone() }),
            ),
            Some(before) => {
                for p in now.iter().filter(|p| !before.iter().any(|b| b.key == p.key)) {
                    notices.push(Notice { kind: p.kind, text: p.text.clone() });
                }
                for b in before.iter().filter(|b| !now.iter().any(|p| p.key == b.key)) {
                    if let Some(solved) = &b.solved {
                        notices.push(Notice { kind: b.kind, text: solved.clone() });
                    }
                }
            }
        }
        self.known = Some(now);
        notices
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tray(name: &str, level: i64) -> Tray {
        Tray {
            name: name.into(),
            manual: false,
            width_mm: 210,
            height_mm: 297,
            capacity: 550,
            level,
            available: true,
        }
    }

    fn snapshot(reasons: &[&str], toner: Option<i32>, trays: Vec<Tray>) -> Snapshot {
        Snapshot::for_test(reasons.iter().map(|r| r.to_string()).collect(), toner, trays)
    }

    fn texts(notices: Vec<Notice>) -> Vec<String> {
        notices.into_iter().map(|n| n.text).collect()
    }

    fn healthy() -> Snapshot {
        snapshot(&[], Some(60), vec![tray("Tray 1", 400), tray("Tray 2", 500)])
    }

    #[test]
    fn a_new_problem_is_told_once() {
        let mut tracker = Tracker::default();
        assert!(tracker.observe(Ok(&healthy())).is_empty());

        let low = snapshot(&["media-low-warning"], Some(60), vec![tray("Tray 1", 400), tray("Tray 2", 55)]);
        assert_eq!(texts(tracker.observe(Ok(&low))), ["Khay 2 sắp hết giấy (còn 55 tờ)"]);
        assert!(tracker.observe(Ok(&low)).is_empty());
    }

    #[test]
    fn a_cleared_stopper_is_told_but_a_cleared_warning_is_not() {
        let mut tracker = Tracker::default();
        tracker.observe(Ok(&healthy()));
        let jammed = snapshot(&["media-jam-error", "toner-low-warning"], Some(10), healthy().trays);
        assert_eq!(texts(tracker.observe(Ok(&jammed))), ["Mực sắp hết (còn 10%)", "Kẹt giấy"]);
        assert_eq!(texts(tracker.observe(Ok(&healthy()))), ["Đã hết kẹt giấy"]);
    }

    #[test]
    fn launch_tells_only_what_stops_the_printer() {
        let mut tracker = Tracker::default();
        let reading = snapshot(&["toner-low-warning", "door-open-error"], Some(10), vec![tray("Tray 1", 0)]);
        assert_eq!(texts(tracker.observe(Ok(&reading))), ["Khay 1 đã hết giấy", "Cửa máy đang mở"]);
    }

    #[test]
    fn the_bypass_tray_and_unknown_levels_never_alarm() {
        let mut bypass = tray("Bypass Tray", 0);
        bypass.manual = true;
        let reading = snapshot(&[], Some(60), vec![bypass, tray("Tray 1", -2)]);
        assert!(problems(&reading).is_empty());
    }

    #[test]
    fn connection_is_lost_on_the_third_failure_and_found_again() {
        let mut tracker = Tracker::default();
        tracker.observe(Ok(&healthy()));
        assert!(tracker.observe(Err("timeout")).is_empty());
        assert!(tracker.observe(Err("timeout")).is_empty());
        assert_eq!(texts(tracker.observe(Err("timeout"))), ["Mất kết nối với máy in"]);
        assert!(tracker.observe(Err("timeout")).is_empty());
        assert_eq!(texts(tracker.observe(Ok(&healthy()))), ["Đã kết nối lại với máy in"]);
    }

    #[test]
    fn a_printer_never_reached_is_not_reported_lost() {
        let mut tracker = Tracker::default();
        for _ in 0..5 {
            assert!(tracker.observe(Err("timeout")).is_empty());
        }
    }

    #[test]
    fn settings_pick_which_kinds_are_shown() {
        let settings = NotifySettings { paper: false, ..NotifySettings::default() };
        assert!(!Kind::Paper.wanted(&settings));
        assert!(Kind::Jam.wanted(&settings));
    }

    /// What a launch would tell about a real printer; sends nothing.
    #[tokio::test]
    #[ignore = "needs a printer on the network"]
    async fn live_launch_notices() {
        let mut settings = crate::settings::PrinterSettings::default();
        if let Ok(host) = std::env::var("RICOH_HOST") {
            settings.host = host;
        }
        let snapshot = crate::snapshot::read_snapshot(settings).await.unwrap();
        for p in problems(&snapshot) {
            println!("{:?} {} → {}", p.kind, p.key, p.text);
        }
        println!("at launch: {:?}", texts(Tracker::default().observe(Ok(&snapshot))));
    }
}
