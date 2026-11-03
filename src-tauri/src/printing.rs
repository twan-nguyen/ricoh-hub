use std::{collections::BTreeMap, io::Cursor, path::Path};

use ipp::{prelude::*, value::IppName};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    printer_ipp::{add_attribute, printer_uri, send_raw, user_name},
    settings::Settings,
};

/// The printer refuses larger jobs long before this; it keeps a stray file out of memory.
const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    pub copies: u16,
    /// IPP `sides`: one-sided, two-sided-long-edge or two-sided-short-edge.
    pub sides: String,
    /// IPP `media-source`: auto, tray-1, tray-2 or manual (the bypass tray).
    pub tray: String,
    /// Pages as people write them, such as "1-3, 5"; empty prints every page.
    pub pages: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedJob {
    id: i32,
    name: String,
}

/// The formats this printer reads itself (`document-format-supported`).
fn document_format(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("pdf") => Ok("application/pdf"),
        Some("jpg" | "jpeg") => Ok("image/jpeg"),
        Some("ps") => Ok("application/postscript"),
        _ => Err("Máy in chỉ nhận file PDF, JPEG hoặc PostScript. Hãy xuất file sang PDF rồi in.".into()),
    }
}

/// Parses "1-3, 5" into inclusive page ranges.
fn page_ranges(text: &str) -> Result<Vec<(i32, i32)>, String> {
    let invalid = || format!("Không hiểu trang “{text}”. Viết như 1-3, 5.");
    text.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (from, to) = part.split_once('-').unwrap_or((part, part));
            let from: i32 = from.trim().parse().map_err(|_| invalid())?;
            let to: i32 = to.trim().parse().map_err(|_| invalid())?;
            if from < 1 || to < from {
                return Err(invalid());
            }
            Ok((from, to))
        })
        .collect()
}

fn keyword(value: &str) -> Result<IppValue, String> {
    IppValue::new_keyword(value).map_err(|e| e.to_string())
}

/// A Print-Job or Validate-Job request carrying the chosen options.
fn job_request(
    operation: Operation,
    host: &str,
    job_name: &str,
    format: &str,
    options: &PrintOptions,
) -> Result<IppRequestResponse, String> {
    let sides = ["one-sided", "two-sided-long-edge", "two-sided-short-edge"];
    if !sides.contains(&options.sides.as_str()) {
        return Err(format!("Kiểu in mặt không hợp lệ: {}", options.sides));
    }
    if !["auto", "tray-1", "tray-2", "manual"].contains(&options.tray.as_str()) {
        return Err(format!("Khay không hợp lệ: {}", options.tray));
    }
    if !(1..=255).contains(&options.copies) {
        return Err("Số bản phải từ 1 đến 255.".into());
    }
    let ranges = page_ranges(&options.pages)?;

    let mut request = IppRequestResponse::new(IppVersion::v1_1(), operation, Some(printer_uri(host)?))
        .map_err(|e| e.to_string())?;
    let op = DelimiterTag::OperationAttributes;
    let text = |s: &str| IppValue::new_name_without_language(s).map_err(|e| e.to_string());
    add_attribute(&mut request, op, IppAttribute::REQUESTING_USER_NAME, text(&user_name())?)?;
    // Job names longer than IPP allows are cut rather than refused.
    let short_name: String = job_name.chars().take(200).collect();
    add_attribute(&mut request, op, IppAttribute::JOB_NAME, text(&short_name)?)?;
    add_attribute(
        &mut request,
        op,
        IppAttribute::DOCUMENT_FORMAT,
        IppValue::new_mime_media_type(format).map_err(|e| e.to_string())?,
    )?;

    let job = DelimiterTag::JobAttributes;
    add_attribute(&mut request, job, "copies", IppValue::Integer(options.copies.into()))?;
    add_attribute(&mut request, job, "sides", keyword(&options.sides)?)?;
    if options.tray != "auto" {
        let source: IppName = "media-source".try_into().map_err(|e: ipp::parser::IppParseError| e.to_string())?;
        let collection = BTreeMap::from([(source, keyword(&options.tray)?)]);
        add_attribute(&mut request, job, "media-col", IppValue::Collection(collection))?;
    }
    if !ranges.is_empty() {
        let values = ranges
            .into_iter()
            .map(|(min, max)| IppValue::RangeOfInteger { min, max })
            .collect();
        add_attribute(&mut request, job, "page-ranges", IppValue::Array(values))?;
    }
    Ok(request)
}

/// What a refusal means for the person printing.
fn refusal(status: StatusCode) -> String {
    match status {
        StatusCode::ClientErrorDocumentFormatNotSupported | StatusCode::ClientErrorDocumentFormatError => {
            "Máy in không đọc được file này. Hãy xuất lại sang PDF rồi in.".into()
        }
        StatusCode::ClientErrorAttributesOrValuesNotSupported | StatusCode::ClientErrorConflictingAttributes => {
            "Máy in không nhận tùy chọn đã chọn (khay, kiểu 2 mặt hoặc trang).".into()
        }
        StatusCode::ClientErrorRequestEntityTooLong => "File quá lớn để máy in nhận.".into(),
        StatusCode::ServerErrorBusy | StatusCode::ServerErrorTemporaryError => {
            "Máy in đang bận. Thử lại sau ít phút.".into()
        }
        StatusCode::ServerErrorNotAcceptingJobs => "Máy in đang không nhận lệnh in mới.".into(),
        StatusCode::ClientErrorNotFound | StatusCode::ClientErrorGone => {
            "Lệnh in không còn trên máy, có thể đã in xong.".into()
        }
        StatusCode::ClientErrorNotPossible => "Lệnh in này không hủy được nữa.".into(),
        StatusCode::ClientErrorForbidden
        | StatusCode::ClientErrorNotAuthorized
        | StatusCode::ClientErrorNotAuthenticated => {
            "Máy in không cho thao tác này, có thể vì lệnh do người khác gửi.".into()
        }
        other => format!("Máy in từ chối: {other:?}"),
    }
}

async fn read_document(path: &Path) -> Result<Vec<u8>, String> {
    let size = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("Không mở được file: {e}"))?
        .len();
    if size == 0 {
        return Err("File rỗng.".into());
    }
    if size > MAX_FILE_BYTES {
        return Err("File lớn hơn 200 MB, máy in sẽ không nhận.".into());
    }
    tokio::fs::read(path).await.map_err(|e| format!("Không đọc được file: {e}"))
}

pub async fn print(host: &str, path: &Path, options: &PrintOptions) -> Result<SubmittedJob, String> {
    let format = document_format(path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Tài liệu".into());
    let bytes = read_document(path).await?;

    let mut request = job_request(Operation::PrintJob, host, &name, format, options)?;
    *request.payload_mut() = IppPayload::new(Cursor::new(bytes));
    let response = send_raw(host, request).await?;
    let status = response.header().status_code();
    if !status.is_success() {
        return Err(refusal(status));
    }
    let id = response
        .attributes()
        .groups_of(DelimiterTag::JobAttributes)
        .next()
        .and_then(|group| group.get("job-id"))
        .and_then(|a| match a.value() {
            IppValue::Integer(n) => Some(*n),
            _ => None,
        })
        .ok_or("Máy in đã nhận lệnh nhưng không trả về mã lệnh.")?;
    Ok(SubmittedJob { id, name })
}

/// Asks the printer whether it would take this job, without printing anything.
#[cfg(test)]
async fn validate(host: &str, path: &Path, options: &PrintOptions) -> Result<(), String> {
    let format = document_format(path)?;
    let request = job_request(Operation::ValidateJob, host, "ricoh-hub", format, options)?;
    let status = send_raw(host, request).await?.header().status_code();
    if status.is_success() { Ok(()) } else { Err(refusal(status)) }
}

pub async fn cancel(host: &str, job_id: i32) -> Result<(), String> {
    let mut request = IppRequestResponse::new(IppVersion::v1_1(), Operation::CancelJob, Some(printer_uri(host)?))
        .map_err(|e| e.to_string())?;
    let op = DelimiterTag::OperationAttributes;
    add_attribute(&mut request, op, IppAttribute::JOB_ID, IppValue::Integer(job_id))?;
    add_attribute(
        &mut request,
        op,
        IppAttribute::REQUESTING_USER_NAME,
        IppValue::new_name_without_language(user_name()).map_err(|e| e.to_string())?,
    )?;
    let status = send_raw(host, request).await?.header().status_code();
    if status.is_success() { Ok(()) } else { Err(refusal(status)) }
}

#[tauri::command]
pub async fn print_file(
    path: String,
    options: PrintOptions,
    settings: State<'_, Settings>,
) -> Result<SubmittedJob, String> {
    print(&settings.get().host, Path::new(&path), &options).await
}

#[tauri::command]
pub async fn cancel_job(job_id: i32, settings: State<'_, Settings>) -> Result<(), String> {
    cancel(&settings.get().host, job_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_page_ranges_as_people_write_them() {
        assert_eq!(page_ranges("").unwrap(), vec![]);
        assert_eq!(page_ranges("1-3, 5").unwrap(), vec![(1, 3), (5, 5)]);
        assert_eq!(page_ranges(" 2 - 4 ,").unwrap(), vec![(2, 4)]);
        assert!(page_ranges("3-1").is_err());
        assert!(page_ranges("0").is_err());
        assert!(page_ranges("a-b").is_err());
    }

    #[test]
    fn knows_which_files_the_printer_reads() {
        assert_eq!(document_format(Path::new("a.PDF")).unwrap(), "application/pdf");
        assert_eq!(document_format(Path::new("scan.jpeg")).unwrap(), "image/jpeg");
        assert!(document_format(Path::new("report.docx")).is_err());
        assert!(document_format(Path::new("no-extension")).is_err());
    }

    fn options() -> PrintOptions {
        PrintOptions {
            copies: 2,
            sides: "two-sided-long-edge".into(),
            tray: "tray-1".into(),
            pages: "1".into(),
        }
    }

    /// Checks the options with the real printer, printing nothing:
    /// `RICOH_HOST=192.168.1.103 cargo test live_validate -- --ignored`.
    #[tokio::test]
    #[ignore = "needs a printer on the network"]
    async fn live_validate_prints_nothing() {
        let host = std::env::var("RICOH_HOST").unwrap_or_else(|_| "192.168.1.103".into());
        validate(&host, Path::new("test.pdf"), &options()).await.unwrap();
    }

    /// A job id the printer never issued must come back as "not found", not as an error of ours.
    #[tokio::test]
    #[ignore = "needs a printer on the network"]
    async fn live_cancel_unknown_job_is_not_found() {
        let host = std::env::var("RICOH_HOST").unwrap_or_else(|_| "192.168.1.103".into());
        let error = cancel(&host, 987_654).await.unwrap_err();
        assert!(error.contains("không còn trên máy"), "{error}");
    }
}
