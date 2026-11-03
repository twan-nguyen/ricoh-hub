use std::time::Duration;

use ipp::{parser::IppParseError, prelude::*, value::IppName};
use serde::Serialize;

const TIMEOUT: Duration = Duration::from_secs(8);

/// Ricoh serves IPP on the web port under `/printer`; port 631 is closed.
fn printer_uri(host: &str) -> Result<Uri, String> {
    format!("http://{host}:80/printer")
        .parse()
        .map_err(|e| format!("Địa chỉ máy in không hợp lệ: {e}"))
}

pub struct PrinterAttributes {
    pub state: i32,
    pub reasons: Vec<String>,
    pub model: Option<String>,
    pub marker_levels: Vec<i32>,
    pub input_trays: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: i32,
    pub name: Option<String>,
    pub user: Option<String>,
    /// RFC 8011 job-state: 3 pending … 9 completed.
    pub state: i32,
    pub pages: Option<i32>,
    /// ISO 8601, when the printer reports `date-time-at-creation`.
    pub created: Option<String>,
}

/// Every string an attribute holds, whether it is one value or a set.
fn strings(value: &IppValue) -> Vec<String> {
    match value {
        IppValue::Array(values) => values.iter().flat_map(strings).collect(),
        IppValue::NoValue => Vec::new(),
        IppValue::OctetString(bytes) => vec![String::from_utf8_lossy(bytes).into_owned()],
        other => vec![other.to_string()],
    }
}

fn ints(value: &IppValue) -> Vec<i32> {
    match value {
        IppValue::Array(values) => values.iter().flat_map(ints).collect(),
        IppValue::Integer(n) | IppValue::Enum(n) => vec![*n],
        _ => Vec::new(),
    }
}

fn first_string(group: &IppAttributeGroup, name: &str) -> Option<String> {
    group
        .get(name)
        .and_then(|a| strings(a.value()).into_iter().next())
        .filter(|s| !s.is_empty())
}

fn first_int(group: &IppAttributeGroup, name: &str) -> Option<i32> {
    group.get(name).and_then(|a| ints(a.value()).into_iter().next())
}

fn iso_date(value: &IppValue) -> Option<String> {
    let IppValue::DateTime(d) = value else { return None };
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        d.year, d.month, d.day, d.hour, d.minutes, d.seconds, d.utc_dir, d.utc_hours, d.utc_mins
    ))
}

fn keywords(names: &[&str]) -> Result<IppValue, String> {
    let values = names
        .iter()
        .map(|n| IppValue::new_keyword(*n))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(IppValue::Array(values))
}

async fn send(host: &str, request: IppRequestResponse) -> Result<IppRequestResponse, String> {
    let client = AsyncIppClient::builder(printer_uri(host)?)
        .request_timeout(TIMEOUT)
        .build();
    let response = client.send(request).await.map_err(|e| format!("IPP: {e}"))?;
    let status = response.header().status_code();
    if !status.is_success() {
        return Err(format!("IPP: máy in trả về {status:?}"));
    }
    Ok(response)
}

pub async fn printer_attributes(host: &str) -> Result<PrinterAttributes, String> {
    let request = IppOperationBuilder::get_printer_attributes(printer_uri(host)?)
        .attributes([
            "printer-state",
            "printer-state-reasons",
            "printer-make-and-model",
            "marker-levels",
            "printer-input-tray",
        ])
        .build()
        .map_err(|e| e.to_string())?;
    let response = send(host, request.into()).await?;
    let group = response
        .attributes()
        .groups_of(DelimiterTag::PrinterAttributes)
        .next()
        .ok_or("IPP: máy in không trả về thuộc tính nào")?;
    let all = |name: &str| group.get(name).map(|a| strings(a.value())).unwrap_or_default();

    Ok(PrinterAttributes {
        state: first_int(group, "printer-state").unwrap_or(0),
        reasons: all("printer-state-reasons")
            .into_iter()
            .filter(|r| r != "none")
            .collect(),
        model: first_string(group, "printer-make-and-model"),
        marker_levels: group.get("marker-levels").map(|a| ints(a.value())).unwrap_or_default(),
        input_trays: all("printer-input-tray"),
    })
}

/// Jobs the printer still holds, newest first. Ricoh drops finished jobs from IPP
/// quickly, so the list is mostly what is queued or printing right now.
pub async fn jobs(host: &str) -> Result<Vec<Job>, String> {
    let (pending, done) = tokio::join!(jobs_of(host, "not-completed"), jobs_of(host, "completed"));
    let mut jobs = pending?;
    jobs.extend(done?);
    jobs.sort_by_key(|j| std::cmp::Reverse(j.id));
    jobs.dedup_by_key(|j| j.id);
    Ok(jobs)
}

async fn jobs_of(host: &str, which: &str) -> Result<Vec<Job>, String> {
    let mut request = IppRequestResponse::new(
        IppVersion::v1_1(),
        Operation::GetJobs,
        Some(printer_uri(host)?),
    )
    .map_err(|e| e.to_string())?;
    let mut add = |name: &str, value: IppValue| -> Result<(), String> {
        let name: IppName = name.try_into().map_err(|e: IppParseError| e.to_string())?;
        request
            .attributes_mut()
            .add(DelimiterTag::OperationAttributes, IppAttribute::new(name, value));
        Ok(())
    };
    add(
        IppAttribute::REQUESTING_USER_NAME,
        IppValue::new_name_without_language("ricoh-hub").map_err(|e| e.to_string())?,
    )?;
    add("which-jobs", IppValue::new_keyword(which).map_err(|e| e.to_string())?)?;
    add(
        IppAttribute::REQUESTED_ATTRIBUTES,
        keywords(&[
            "job-id",
            "job-name",
            "job-originating-user-name",
            "job-state",
            "job-impressions-completed",
            "date-time-at-creation",
        ])?,
    )?;

    let response = send(host, request).await?;
    Ok(response
        .attributes()
        .groups_of(DelimiterTag::JobAttributes)
        .filter_map(|group| {
            Some(Job {
                id: first_int(group, "job-id")?,
                name: first_string(group, "job-name"),
                user: first_string(group, "job-originating-user-name"),
                state: first_int(group, "job-state").unwrap_or(0),
                pages: first_int(group, "job-impressions-completed"),
                created: group.get("date-time-at-creation").and_then(|a| iso_date(a.value())),
            })
        })
        .collect())
}
