use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use reqwest::{Client, StatusCode, header::LOCATION};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, ipc::Channel};
use tauri_plugin_opener::OpenerExt;

use crate::settings::Settings;

/// A page on the glass or a sheet through the feeder can take a while at 600 dpi.
const PAGE_TIMEOUT: Duration = Duration::from_secs(90);
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
/// How long to wait before asking again when the scanner says it is not ready yet.
const RETRY_DELAY: Duration = Duration::from_millis(800);

const ESCL_NS: &str = "http://schemas.hp.com/imaging/escl/2011/05/03";
const PWG_NS: &str = "http://www.pwg.org/schemas/2010/12/sm";

fn base_url(host: &str) -> String {
    format!("http://{host}/eSCL")
}

fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}

/// Text of every element with this local name, in document order.
fn texts<'a>(doc: &'a roxmltree::Document, name: &str) -> Vec<&'a str> {
    doc.descendants()
        .filter(|n| n.tag_name().name() == name)
        .filter_map(|n| n.text())
        .map(str::trim)
        .collect()
}

fn unique(values: Vec<&str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        if !out.iter().any(|o| o == v) {
            out.push(v.to_string());
        }
    }
    out
}

/// What the scanner offers, from `ScannerCapabilities`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannerCapabilities {
    version: String,
    has_feeder: bool,
    feeder_duplex: bool,
    color_modes: Vec<String>,
    resolutions: Vec<u32>,
    formats: Vec<String>,
    max_width_mm: u32,
    max_height_mm: u32,
}

/// eSCL regions count in 1/300 inch.
fn to_mm(three_hundredths: u32) -> u32 {
    (three_hundredths as f64 * 25.4 / 300.0).round() as u32
}

fn to_three_hundredths(mm: u32) -> u32 {
    (mm as f64 * 300.0 / 25.4).round() as u32
}

fn parse_capabilities(xml: &str) -> Result<ScannerCapabilities, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("eSCL: XML lỗi: {e}"))?;
    // The protocol version is the root's own Version, not the certifications' ones nested deeper.
    let version = doc
        .root_element()
        .children()
        .find(|n| n.tag_name().name() == "Version")
        .and_then(|n| n.text())
        .unwrap_or("2.0")
        .trim()
        .to_string();
    let first_number = |name: &str| texts(&doc, name).first().and_then(|t| t.parse::<u32>().ok());
    let mut resolutions: Vec<u32> = texts(&doc, "XResolution")
        .into_iter()
        .filter_map(|t| t.parse().ok())
        .collect();
    resolutions.sort_unstable();
    resolutions.dedup();

    Ok(ScannerCapabilities {
        version,
        has_feeder: doc.descendants().any(|n| n.tag_name().name() == "Adf"),
        feeder_duplex: texts(&doc, "AdfOption").contains(&"Duplex"),
        color_modes: unique(texts(&doc, "ColorMode")),
        resolutions,
        formats: unique(texts(&doc, "DocumentFormatExt")),
        max_width_mm: first_number("MaxWidth").map(to_mm).unwrap_or(216),
        max_height_mm: first_number("MaxHeight").map(to_mm).unwrap_or(297),
    })
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannerStatus {
    /// `Idle`, `Processing`, `Testing` or `Stopped`.
    state: String,
    /// `ScannerAdfLoaded`, `ScannerAdfEmpty`, `ScannerAdfJam`, …; absent without a feeder.
    adf_state: Option<String>,
}

fn parse_status(xml: &str) -> Result<ScannerStatus, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("eSCL: XML lỗi: {e}"))?;
    Ok(ScannerStatus {
        state: texts(&doc, "State").first().unwrap_or(&"Unknown").to_string(),
        adf_state: texts(&doc, "AdfState").first().map(|s| s.to_string()),
    })
}

async fn get_text(host: &str, path: &str) -> Result<String, String> {
    let response = client(STATUS_TIMEOUT)?
        .get(format!("{}/{path}", base_url(host)))
        .send()
        .await
        .map_err(|e| format!("eSCL: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("eSCL: máy trả về {}", response.status()));
    }
    response.text().await.map_err(|e| format!("eSCL: {e}"))
}

pub async fn capabilities(host: &str) -> Result<ScannerCapabilities, String> {
    parse_capabilities(&get_text(host, "ScannerCapabilities").await?)
}

pub async fn status(host: &str) -> Result<ScannerStatus, String> {
    parse_status(&get_text(host, "ScannerStatus").await?)
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    /// `Platen` (the glass) or `Feeder` (the document feeder).
    pub source: String,
    pub duplex: bool,
    /// `BlackAndWhite1`, `Grayscale8` or `RGB24`.
    pub color_mode: String,
    pub resolution: u32,
    /// Paper size of the original, in millimetres, short edge first.
    pub width_mm: u32,
    pub height_mm: u32,
    /// `application/pdf` or `image/jpeg`.
    pub format: String,
}

impl ScanOptions {
    fn check(&self, caps: &ScannerCapabilities) -> Result<(), String> {
        match self.source.as_str() {
            "Platen" => {}
            "Feeder" if caps.has_feeder => {}
            _ => return Err("Máy không có nguồn scan này.".into()),
        }
        if self.duplex && !(self.source == "Feeder" && caps.feeder_duplex) {
            return Err("Chỉ scan 2 mặt được khi dùng khay nạp bản gốc.".into());
        }
        if !caps.color_modes.contains(&self.color_mode) {
            return Err(format!("Máy không hỗ trợ chế độ màu {}.", self.color_mode));
        }
        if !caps.resolutions.contains(&self.resolution) {
            return Err(format!("Máy không hỗ trợ {} dpi.", self.resolution));
        }
        if !caps.formats.contains(&self.format) {
            return Err(format!("Máy không xuất được {}.", self.format));
        }
        if self.width_mm > caps.max_width_mm || self.height_mm > caps.max_height_mm {
            return Err("Khổ giấy lớn hơn vùng scan của máy.".into());
        }
        Ok(())
    }
}

/// The `ScanSettings` body for `POST /eSCL/ScanJobs`.
fn scan_settings_xml(options: &ScanOptions, version: &str) -> String {
    let duplex = if options.source == "Feeder" {
        format!("\n  <scan:Duplex>{}</scan:Duplex>", options.duplex)
    } else {
        String::new()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="{ESCL_NS}" xmlns:pwg="{PWG_NS}">
  <pwg:Version>{version}</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions pwg:MustHonor="false">
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>{width}</pwg:Width>
      <pwg:Height>{height}</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>{source}</pwg:InputSource>
  <scan:ColorMode>{color}</scan:ColorMode>
  <scan:XResolution>{dpi}</scan:XResolution>
  <scan:YResolution>{dpi}</scan:YResolution>
  <pwg:DocumentFormat>{format}</pwg:DocumentFormat>
  <scan:DocumentFormatExt>{format}</scan:DocumentFormatExt>{duplex}
</scan:ScanSettings>
"#,
        width = to_three_hundredths(options.width_mm),
        height = to_three_hundredths(options.height_mm),
        source = options.source,
        color = options.color_mode,
        dpi = options.resolution,
        format = options.format,
    )
}

/// Where the scan job lives: the `Location` header, absolute or relative to the host.
fn job_url(host: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        location.trim_end_matches('/').to_string()
    } else {
        format!("http://{host}{}", location.trim_end_matches('/'))
    }
}

/// "Scan 2026-11-04 01.12.30.pdf", then " (2)" and on for the next documents of the same job.
fn file_name(stamp: &str, index: usize, format: &str) -> String {
    let extension = if format == "image/jpeg" { "jpg" } else { "pdf" };
    if index == 0 {
        format!("Scan {stamp}.{extension}")
    } else {
        format!("Scan {stamp} ({}).{extension}", index + 1)
    }
}

/// Progress for the scan view, sent while the job runs.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ScanEvent {
    Started,
    /// One document arrived and was saved.
    Saved { path: String, bytes: u64 },
}

/// The job being scanned, so a cancel can reach it.
#[derive(Default)]
pub struct ActiveScan(Mutex<Option<String>>);

fn refusal(status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "Máy đòi đăng nhập mới cho scan từ máy tính.".into()
        }
        StatusCode::CONFLICT | StatusCode::SERVICE_UNAVAILABLE => {
            "Máy scan đang bận. Thử lại sau ít phút.".into()
        }
        StatusCode::BAD_REQUEST => "Máy không nhận tùy chọn scan đã chọn.".into(),
        other => format!("Máy scan từ chối: {other}"),
    }
}

async fn scan(
    host: &str,
    folder: &Path,
    options: &ScanOptions,
    active: &ActiveScan,
    progress: &Channel<ScanEvent>,
) -> Result<Vec<String>, String> {
    let caps = capabilities(host).await?;
    options.check(&caps)?;
    if options.source == "Feeder" {
        match status(host).await?.adf_state.as_deref() {
            Some("ScannerAdfLoaded") | None => {}
            Some("ScannerAdfJam") => return Err("Bản gốc bị kẹt trong khay nạp.".into()),
            Some(_) => return Err("Chưa có giấy trong khay nạp bản gốc.".into()),
        }
    }
    tokio::fs::create_dir_all(folder)
        .await
        .map_err(|e| format!("Không tạo được thư mục lưu: {e}"))?;

    let http = client(PAGE_TIMEOUT)?;
    let created = http
        .post(format!("{}/ScanJobs", base_url(host)))
        .header("Content-Type", "text/xml")
        .body(scan_settings_xml(options, &caps.version))
        .send()
        .await
        .map_err(|e| format!("eSCL: {e}"))?;
    if created.status() != StatusCode::CREATED {
        return Err(refusal(created.status()));
    }
    let location = created
        .headers()
        .get(LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or("Máy nhận lệnh scan nhưng không cho biết job ở đâu.")?;
    let job = job_url(host, location);
    *active.0.lock().unwrap() = Some(job.clone());
    let _ = progress.send(ScanEvent::Started);

    let stamp = jiff::Zoned::now().strftime("%Y-%m-%d %H.%M.%S").to_string();
    let mut saved = Vec::new();
    let result = loop {
        // A cancel clears the job; stop asking for pages.
        if active.0.lock().unwrap().is_none() {
            break Err("Đã hủy scan.".to_string());
        }
        let response = match http.get(format!("{job}/NextDocument")).send().await {
            Ok(r) => r,
            Err(e) => break Err(format!("eSCL: {e}")),
        };
        match response.status() {
            StatusCode::OK => {
                let bytes = match response.bytes().await {
                    Ok(b) => b,
                    Err(e) => break Err(format!("eSCL: {e}")),
                };
                let path = folder.join(file_name(&stamp, saved.len(), &options.format));
                if let Err(e) = tokio::fs::write(&path, &bytes).await {
                    break Err(format!("Không lưu được file: {e}"));
                }
                let path = path.to_string_lossy().into_owned();
                let _ = progress.send(ScanEvent::Saved { path: path.clone(), bytes: bytes.len() as u64 });
                saved.push(path);
            }
            // No more documents in this job.
            StatusCode::NOT_FOUND | StatusCode::GONE => break Ok(()),
            // Still warming up or moving paper.
            StatusCode::SERVICE_UNAVAILABLE => tokio::time::sleep(RETRY_DELAY).await,
            other => break Err(refusal(other)),
        }
    };

    *active.0.lock().unwrap() = None;
    match result {
        Ok(()) if saved.is_empty() => Err("Máy không trả về trang nào. Kiểm tra bản gốc đã đặt đúng chưa.".into()),
        Ok(()) => Ok(saved),
        Err(e) => {
            // Leave nothing half-done on the scanner.
            let _ = http.delete(&job).send().await;
            Err(e)
        }
    }
}

/// The folder scans go to: the one chosen in Settings, else Downloads/Ricoh Scans.
fn scan_folder(app: &AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    match settings.get().scan_folder {
        Some(folder) => Ok(PathBuf::from(folder)),
        None => Ok(app
            .path()
            .download_dir()
            .map_err(|e| e.to_string())?
            .join("Ricoh Scans")),
    }
}

/// Opening or revealing only reaches files inside the scan folder.
fn inside_scan_folder(app: &AppHandle, settings: &Settings, path: &str) -> Result<PathBuf, String> {
    let folder = scan_folder(app, settings)?;
    let path = PathBuf::from(path);
    if path.parent() != Some(folder.as_path()) {
        return Err("File không nằm trong thư mục scan.".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn get_scanner(settings: State<'_, Settings>) -> Result<ScannerCapabilities, String> {
    capabilities(&settings.get().host).await
}

#[tauri::command]
pub async fn get_scanner_status(settings: State<'_, Settings>) -> Result<ScannerStatus, String> {
    status(&settings.get().host).await
}

#[tauri::command]
pub fn get_scan_folder(app: AppHandle, settings: State<'_, Settings>) -> Result<String, String> {
    Ok(scan_folder(&app, &settings)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn start_scan(
    options: ScanOptions,
    on_progress: Channel<ScanEvent>,
    app: AppHandle,
    settings: State<'_, Settings>,
    active: State<'_, ActiveScan>,
) -> Result<Vec<String>, String> {
    if active.0.lock().unwrap().is_some() {
        return Err("Đang có một lần scan chưa xong.".into());
    }
    let folder = scan_folder(&app, &settings)?;
    scan(&settings.get().host, &folder, &options, &active, &on_progress).await
}

#[tauri::command]
pub async fn cancel_scan(active: State<'_, ActiveScan>) -> Result<(), String> {
    let job = active.0.lock().unwrap().take();
    if let Some(job) = job {
        // The scan loop sees the cleared job and stops; this tells the scanner too.
        let _ = client(STATUS_TIMEOUT)?.delete(&job).send().await;
    }
    Ok(())
}

#[tauri::command]
pub fn open_scan(path: String, app: AppHandle, settings: State<'_, Settings>) -> Result<(), String> {
    let path = inside_scan_folder(&app, &settings, &path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_scan(path: String, app: AppHandle, settings: State<'_, Settings>) -> Result<(), String> {
    let path = inside_scan_folder(&app, &settings, &path)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPS: &str = include_str!("fixtures/escl-capabilities.xml");
    const STATUS: &str = include_str!("fixtures/escl-status-adf-empty.xml");

    fn options() -> ScanOptions {
        ScanOptions {
            source: "Feeder".into(),
            duplex: true,
            color_mode: "Grayscale8".into(),
            resolution: 300,
            width_mm: 210,
            height_mm: 297,
            format: "application/pdf".into(),
        }
    }

    #[test]
    fn reads_this_printers_capabilities() {
        let caps = parse_capabilities(CAPS).unwrap();
        assert_eq!(caps.version, "2.63");
        assert!(caps.has_feeder && caps.feeder_duplex);
        assert_eq!(caps.color_modes, ["BlackAndWhite1", "Grayscale8", "RGB24"]);
        assert_eq!(caps.resolutions, [100, 200, 300, 400, 600]);
        assert_eq!(caps.formats, ["application/pdf", "image/jpeg", "image/tiff"]);
        assert_eq!((caps.max_width_mm, caps.max_height_mm), (297, 432));
    }

    #[test]
    fn reads_scanner_status() {
        let status = parse_status(STATUS).unwrap();
        assert_eq!(status.state, "Idle");
        assert_eq!(status.adf_state.as_deref(), Some("ScannerAdfEmpty"));
    }

    #[test]
    fn checks_options_against_the_scanner() {
        let caps = parse_capabilities(CAPS).unwrap();
        assert!(options().check(&caps).is_ok());
        let glass_duplex = ScanOptions { source: "Platen".into(), ..options() };
        assert!(glass_duplex.check(&caps).is_err());
        let too_fine = ScanOptions { resolution: 1200, ..options() };
        assert!(too_fine.check(&caps).is_err());
        let too_big = ScanOptions { width_mm: 330, height_mm: 483, ..options() };
        assert!(too_big.check(&caps).is_err());
    }

    #[test]
    fn writes_scan_settings_for_a4_at_300_dpi() {
        let xml = scan_settings_xml(&options(), "2.63");
        // The body must parse and carry A4 in 1/300 inch.
        let doc = roxmltree::Document::parse(&xml).unwrap();
        assert_eq!(texts(&doc, "Width"), ["2480"]);
        assert_eq!(texts(&doc, "Height"), ["3508"]);
        assert_eq!(texts(&doc, "InputSource"), ["Feeder"]);
        assert_eq!(texts(&doc, "Duplex"), ["true"]);
        let glass = scan_settings_xml(&ScanOptions { source: "Platen".into(), duplex: false, ..options() }, "2.63");
        assert!(!glass.contains("Duplex"));
    }

    #[test]
    fn resolves_job_locations_and_names_files() {
        assert_eq!(job_url("10.0.0.5", "/eSCL/ScanJobs/abc/"), "http://10.0.0.5/eSCL/ScanJobs/abc");
        assert_eq!(job_url("10.0.0.5", "http://10.0.0.5:80/eSCL/ScanJobs/abc"), "http://10.0.0.5:80/eSCL/ScanJobs/abc");
        assert_eq!(file_name("2026-11-04 01.12.30", 0, "application/pdf"), "Scan 2026-11-04 01.12.30.pdf");
        assert_eq!(file_name("2026-11-04 01.12.30", 2, "image/jpeg"), "Scan 2026-11-04 01.12.30 (3).jpg");
    }

    /// Reads the real scanner, scanning nothing:
    /// `RICOH_HOST=192.168.1.103 cargo test live_scanner -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "needs a printer on the network"]
    async fn live_scanner_reads_capabilities_and_status() {
        let host = std::env::var("RICOH_HOST").unwrap_or_else(|_| "192.168.1.103".into());
        let caps = capabilities(&host).await.unwrap();
        assert!(caps.has_feeder);
        println!("{}", serde_json::to_string(&status(&host).await.unwrap()).unwrap());
    }

    /// Scans whatever lies on the glass, once, into a temp folder. Runs the scanner, so it
    /// also needs RICOH_SCAN=1: `RICOH_SCAN=1 cargo test live_scan_glass -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "runs the real scanner"]
    async fn live_scan_glass_once() {
        if std::env::var("RICOH_SCAN").as_deref() != Ok("1") {
            return;
        }
        let host = std::env::var("RICOH_HOST").unwrap_or_else(|_| "192.168.1.103".into());
        let folder = std::env::temp_dir().join("ricoh-hub-scan-test");
        let options = ScanOptions {
            source: "Platen".into(),
            duplex: false,
            resolution: 200,
            ..options()
        };
        let channel = Channel::new(|_| Ok(()));
        let saved = scan(&host, &folder, &options, &ActiveScan::default(), &channel).await.unwrap();
        for path in &saved {
            let bytes = std::fs::read(path).unwrap();
            println!("{path}: {} bytes, starts with {:?}", bytes.len(), String::from_utf8_lossy(&bytes[..8]));
        }
        assert!(!saved.is_empty());
    }
}
