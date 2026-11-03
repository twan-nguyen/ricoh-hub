use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::{
    printer_ipp::{self, Job},
    settings::{PrinterSettings, Settings},
    snmp::Snmp,
};

const SYS_DESCR: &[u64] = &[1, 3, 6, 1, 2, 1, 1, 1, 0];
const SYS_UPTIME: &[u64] = &[1, 3, 6, 1, 2, 1, 1, 3, 0];
const SYS_NAME: &[u64] = &[1, 3, 6, 1, 2, 1, 1, 5, 0];
/// Printer-MIB prtGeneralSerialNumber.
const SERIAL: &[u64] = &[1, 3, 6, 1, 2, 1, 43, 5, 1, 1, 17, 1];
/// Printer-MIB prtConsoleDisplayBufferText: what the control panel shows.
const CONSOLE: &[u64] = &[1, 3, 6, 1, 2, 1, 43, 16, 5, 1, 2];
/// Printer-MIB prtAlertDescription.
const ALERTS: &[u64] = &[1, 3, 6, 1, 2, 1, 43, 18, 1, 1, 8];
/// Ricoh private counter table: names and values share the row index.
const COUNTER_NAMES: &[u64] = &[1, 3, 6, 1, 4, 1, 367, 3, 2, 1, 2, 19, 5, 1, 6];
const COUNTER_VALUES: &[u64] = &[1, 3, 6, 1, 4, 1, 367, 3, 2, 1, 2, 19, 5, 1, 9];

/// Everything the dashboard shows, read in one pass.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    host: String,
    model: Option<String>,
    name: Option<String>,
    serial: Option<String>,
    firmware: Option<String>,
    uptime_seconds: Option<i64>,
    /// IPP printer-state: 3 idle, 4 processing, 5 stopped.
    state: i32,
    /// IPP printer-state-reasons, such as `media-low-warning`.
    reasons: Vec<String>,
    /// Messages from the printer's alert table, as the control panel words them.
    alerts: Vec<String>,
    display: Option<String>,
    /// Black toner left, in percent; Ricoh reports it in steps.
    toner: Option<i32>,
    trays: Vec<Tray>,
    counters: Vec<Counter>,
    jobs: Vec<Job>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tray {
    name: String,
    manual: bool,
    /// Paper size in millimetres, short edge first.
    width_mm: i64,
    height_mm: i64,
    capacity: i64,
    /// Sheets left; -2 unknown, -3 "some" (RFC 3805).
    level: i64,
    /// Low bits of PrtSubUnitStatus: 0, 2, 4, 6 available; 1, 3, 5 not.
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counter {
    index: u64,
    name: String,
    value: i64,
}

/// Parses one `printer-input-tray` value: `type=…;mediafeed=210000;…;name=Tray 1;`.
fn parse_tray(raw: &str) -> Option<Tray> {
    let fields: HashMap<&str, &str> = raw
        .split(';')
        .filter_map(|pair| pair.split_once('='))
        .collect();
    let kind = fields.get("type").copied().unwrap_or("");
    // Ricoh lists "auto" (tray selection) as a tray of type "other"; it is not paper.
    if kind == "other" {
        return None;
    }
    let number = |key: &str| fields.get(key).and_then(|v| v.parse::<i64>().ok());
    // Dimensions are in micrometres.
    let feed = number("mediafeed").unwrap_or(0) / 1000;
    let cross = number("mediaxfeed").unwrap_or(0) / 1000;
    Some(Tray {
        name: fields.get("name").map(|n| n.replace("\\ ", " ")).unwrap_or_default(),
        manual: kind == "sheetFeedManual",
        width_mm: feed.min(cross),
        height_mm: feed.max(cross),
        capacity: number("maxcapacity").unwrap_or(-2),
        level: number("level").unwrap_or(-2),
        available: number("status").is_none_or(|s| s % 2 == 0),
    })
}

/// "RICOH IM 3500 5.30 / RICOH Network Printer …": the version ends the first part.
fn firmware(description: &str) -> Option<String> {
    let version = description.split('/').next()?.split_whitespace().last()?;
    version.contains('.').then(|| version.to_string())
}

/// Alerts end in a Ricoh code such as `{10033}`; the text alone reads better.
fn alert_text(raw: String) -> String {
    match raw.find(" {") {
        Some(at) => raw[..at].to_string(),
        None => raw,
    }
}

struct SnmpPart {
    description: Option<String>,
    uptime_seconds: Option<i64>,
    name: Option<String>,
    serial: Option<String>,
    display: Option<String>,
    alerts: Vec<String>,
    counters: Vec<Counter>,
}

async fn read_snmp(host: &str, community: &str) -> Result<SnmpPart, String> {
    let mut snmp = Snmp::connect(host, community).await?;
    let mut scalars = snmp.get(&[SYS_DESCR, SYS_UPTIME, SYS_NAME, SERIAL]).await?.into_iter();
    let mut next = || scalars.next();
    let description = next().and_then(|v| v.text());
    // sysUpTime counts hundredths of a second.
    let uptime_seconds = next().and_then(|v| v.int()).map(|t| t / 100);
    let name = next().and_then(|v| v.text());
    let serial = next().and_then(|v| v.text());

    let display = snmp.walk(CONSOLE).await?.into_iter().find_map(|(_, v)| v.text());
    let mut alerts: Vec<String> = snmp
        .walk(ALERTS)
        .await?
        .into_iter()
        .filter_map(|(_, v)| v.text().map(alert_text))
        .collect();
    alerts.dedup();

    let values: HashMap<u64, i64> = snmp
        .walk(COUNTER_VALUES)
        .await?
        .into_iter()
        .filter_map(|(suffix, v)| Some((*suffix.last()?, v.int()?)))
        .collect();
    let counters = snmp
        .walk(COUNTER_NAMES)
        .await?
        .into_iter()
        .filter_map(|(suffix, v)| {
            let index = *suffix.last()?;
            Some(Counter {
                index,
                name: v.text()?,
                value: *values.get(&index)?,
            })
        })
        .collect();

    Ok(SnmpPart {
        description,
        uptime_seconds,
        name,
        serial,
        display,
        alerts,
        counters,
    })
}

#[tauri::command]
pub async fn get_snapshot(settings: State<'_, Settings>) -> Result<Snapshot, String> {
    read_snapshot(settings.get()).await
}

async fn read_snapshot(settings: PrinterSettings) -> Result<Snapshot, String> {
    let host = settings.host.as_str();
    let (printer, jobs, snmp) = tokio::join!(
        printer_ipp::printer_attributes(host),
        printer_ipp::jobs(host),
        read_snmp(host, &settings.community),
    );
    let (printer, jobs, snmp) = (printer?, jobs?, snmp?);

    Ok(Snapshot {
        host: settings.host.clone(),
        model: printer.model,
        name: snmp.name,
        serial: snmp.serial,
        firmware: snmp.description.as_deref().and_then(firmware),
        uptime_seconds: snmp.uptime_seconds,
        state: printer.state,
        reasons: printer.reasons,
        alerts: snmp.alerts,
        display: snmp.display,
        toner: printer.marker_levels.first().copied().filter(|level| *level >= 0),
        trays: printer.input_trays.iter().filter_map(|t| parse_tray(t)).collect(),
        counters: snmp.counters,
        jobs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ricoh_trays_and_skips_auto() {
        let auto = "type=other;mediafeed=210000;mediaxfeed=297000;maxcapacity=550;level=385;status=0;name=auto;";
        assert!(parse_tray(auto).is_none());

        let tray = parse_tray("type=sheetFeedAutoRemovableTray;mediafeed=420000;mediaxfeed=297000;maxcapacity=550;level=55;status=0;name=Tray 2;").unwrap();
        assert_eq!((tray.name.as_str(), tray.width_mm, tray.height_mm), ("Tray 2", 297, 420));
        assert_eq!((tray.level, tray.capacity, tray.available, tray.manual), (55, 550, true, false));

        let bypass = parse_tray("type=sheetFeedManual;mediafeed=215900;mediaxfeed=279400;maxcapacity=100;level=0;status=3;name=Bypass Tray;").unwrap();
        assert_eq!((bypass.width_mm, bypass.height_mm), (215, 279));
        assert!(bypass.manual && !bypass.available);
    }

    #[test]
    fn reads_firmware_and_alert_text() {
        let descr = "RICOH IM 3500 5.30 / RICOH Network Printer C model / RICOH Network Scanner C model";
        assert_eq!(firmware(descr).as_deref(), Some("5.30"));
        assert_eq!(alert_text("Energy Saver Mode {10033}".into()), "Energy Saver Mode");
    }

    /// Reads a real printer: `RICOH_HOST=192.168.1.103 cargo test live -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "needs a printer on the network"]
    async fn live_snapshot() {
        let mut settings = PrinterSettings::default();
        if let Ok(host) = std::env::var("RICOH_HOST") {
            settings.host = host;
        }
        let snapshot = read_snapshot(settings).await.unwrap();
        println!("{}", serde_json::to_string_pretty(&snapshot).unwrap());
        assert!(!snapshot.trays.is_empty());
        assert!(!snapshot.counters.is_empty());
    }
}
