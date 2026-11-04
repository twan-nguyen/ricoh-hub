//! Files kept in the printer's Document Server, read from Web Image Monitor as a guest.
//!
//! Downloading takes the same two steps as the web page: the printer first
//! prepares the file, then hands it over. The file stays on the printer.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use reqwest::{Client, header};
use serde::Serialize;
use tauri::{AppHandle, State, ipc::Response};
use tokio::sync::Mutex;

use crate::{scanning::scan_folder, settings::Settings};

const TIMEOUT: Duration = Duration::from_secs(15);
/// The printer builds the PDF before sending it; a long document takes a while.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);

/// One file in the Shared Folder, as its thumbnail's caption describes it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    doc_id: String,
    name: String,
    /// Printer's local time, "2026-10-30T23:47:00"; none when the caption could not be read.
    created: Option<String>,
    pages: Option<u32>,
    /// "Scanner", "Copier" or "Printer".
    function: Option<String>,
    /// "Full Color", "Black & White"…
    color: Option<String>,
    /// Pass to `get_stored_thumbnail`.
    thumbnail_id: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredFiles {
    /// All files in the folder; the page lists at most the first few.
    total: u32,
    files: Vec<StoredFile>,
}

/// Web Image Monitor keeps one session per computer, so two walks to the list
/// at once would trip over each other.
#[derive(Default)]
pub struct Docbox(Mutex<()>);

fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}

/// Cookies a browser would hold for Web Image Monitor during one walk to the list.
/// The session cookie is scoped to a path; sending it everywhere is harmless here.
struct Jar(Vec<(String, String)>);

impl Jar {
    fn new() -> Self {
        Self(vec![
            ("cookieOnOffChecker".into(), "on".into()),
            // The page shows ten files unless told otherwise; twenty is the most it offers.
            ("docList_rowBlockSize".into(), "20".into()),
        ])
    }

    fn header(&self) -> String {
        self.0.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ")
    }

    fn keep(&mut self, response: &reqwest::Response) {
        for value in response.headers().get_all(header::SET_COOKIE) {
            let Some((name, rest)) = value.to_str().ok().and_then(|v| v.split_once('=')) else {
                continue;
            };
            // Only the session matters; the list's view settings stay as asked for.
            if name.trim() != "risessionid" {
                continue;
            }
            let value = rest.split(';').next().unwrap_or_default().to_string();
            self.0.retain(|(k, _)| k != "risessionid");
            self.0.push(("risessionid".into(), value));
        }
    }
}

/// Web Image Monitor answers "session timed out" unless a page is reached the way a
/// browser would: from the main frame, with the session cookie the folder page sets.
async fn page(client: &Client, jar: &mut Jar, url: &str, referer: Option<&str>) -> Result<String, String> {
    let mut request = client.get(url).header(header::COOKIE, jar.header());
    if let Some(referer) = referer {
        request = request.header(header::REFERER, referer);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Không mở được Web Image Monitor: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Web Image Monitor trả về {}", response.status()));
    }
    jar.keep(&response);
    response.text().await.map_err(|e| e.to_string())
}

/// The Shared Folder's list page, with the session that read it and its address.
struct ListPage {
    client: Client,
    jar: Jar,
    url: String,
    html: String,
}

async fn open_list(host: &str) -> Result<ListPage, String> {
    let client = client(TIMEOUT)?;
    let mut jar = Jar::new();
    let base = format!("http://{host}/web/guest/en");
    let top = format!("{base}/websys/webArch/topPage.cgi");
    let folders = format!("{base}/webdocbox/folderListPage.cgi");
    page(&client, &mut jar, &format!("{base}/websys/webArch/mainFrame.cgi"), None).await?;
    page(&client, &mut jar, &top, None).await?;
    page(&client, &mut jar, &folders, Some(&top)).await?;
    // Folder 0 is the Shared Folder, where the panel stores scans unless a user folder is picked.
    let url = format!("{base}/webdocbox/docListPage.cgi?selectedFolderId=0&subReturnDsp=3");
    let html = page(&client, &mut jar, &url, Some(&folders)).await?;
    Ok(ListPage {
        client,
        jar,
        url,
        html,
    })
}

const NOT_A_LIST: &str = "Máy in không mở danh sách Document Server.";

async fn list(host: &str) -> Result<StoredFiles, String> {
    parse_list(&open_list(host).await?.html).ok_or_else(|| NOT_A_LIST.into())
}

/// `application/x-www-form-urlencoded`, written out: reqwest is built without its form helper.
fn form(fields: &[(&str, &str)]) -> String {
    let encode = |text: &str| {
        text.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    fields
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// The PDF link the list page keeps for a file, in its hidden download form.
fn download_link(html: &str, doc_id: &str) -> Option<String> {
    let mark = format!("name=\"displayedDocIds\" value=\"{doc_id}\"");
    html.match_indices(&mark).find_map(|(at, _)| {
        let rest = &html[at + mark.len()..];
        let row = &rest[..rest.find("name=\"displayedDocIds\"").unwrap_or(rest.len())];
        let link = attribute(&row[row.find("name=\"pdfURI\"")?..], "value")?;
        (!link.is_empty()).then(|| unescape(link))
    })
}

/// What the prepared page's `pageDownload('…')` posts: the file's address and its fields.
/// The query is base64; `id` and `jt` end at `&`, and `el` runs to the end, as the page's script reads them.
fn content_request(page: &str) -> Option<(String, Vec<(&'static str, String)>)> {
    let start = page.find("pageDownload('")? + "pageDownload('".len();
    let url = &page[start..start + page[start..].find('\'')?];
    let (base, encoded) = url.split_once('?')?;
    let query = String::from_utf8(BASE64.decode(encoded).ok()?).ok()?;
    let until_amp = |name: &str| {
        let from = query.find(&format!("{name}="))? + name.len() + 1;
        Some(query[from..from + query[from..].find('&')?].to_string())
    };
    let el = &query[query.find("el=")? + 3..];
    Some((
        format!("{base}?"),
        vec![
            ("id", until_amp("id")?),
            ("jt", until_amp("jt")?),
            ("el", el.to_string()),
            ("browserTypeVal", "4".into()),
        ],
    ))
}

/// "SCAN0100.pdf", or "SCAN0100 (2).pdf" when that name is taken.
fn free_path(folder: &Path, name: &str) -> PathBuf {
    let stem: String = name
        .trim()
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c })
        .collect();
    let stem = if stem.is_empty() { "Document Server".to_string() } else { stem };
    (1..)
        .map(|n| match n {
            1 => folder.join(format!("{stem}.pdf")),
            n => folder.join(format!("{stem} ({n}).pdf")),
        })
        .find(|path| !path.exists())
        .expect("some numbered name is free")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    path: String,
    bytes: u64,
}

async fn download(host: &str, doc_id: &str, folder: &Path) -> Result<Downloaded, String> {
    let ListPage {
        client: session,
        mut jar,
        url: list_url,
        html,
    } = open_list(host).await?;
    let list = parse_list(&html).ok_or(NOT_A_LIST)?;
    let file = list
        .files
        .iter()
        .find(|f| f.doc_id == doc_id)
        .ok_or("File không còn trên máy in.")?;
    let link = download_link(&html, doc_id).ok_or("Máy in không cho tải file này dạng PDF.")?;
    let token = attribute(&html[html.find("name=\"wimToken\"").ok_or(NOT_A_LIST)?..], "value")
        .ok_or(NOT_A_LIST)?;

    // Step one: the printer prepares the PDF and answers with a page that points at it.
    let prepare_url = format!("http://{host}{link}");
    let prepared = session
        .post(&prepare_url)
        .header(header::COOKIE, jar.header())
        .header(header::REFERER, &list_url)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form(&[("wimToken", token), ("offset", "0")]))
        .send()
        .await
        .map_err(|e| format!("Không mở được Web Image Monitor: {e}"))?;
    jar.keep(&prepared);
    let prepared = prepared.text().await.map_err(|e| e.to_string())?;
    let (content_url, fields) = content_request(&prepared).ok_or("Máy in không chuẩn bị được file để tải.")?;
    let fields: Vec<(&str, &str)> = fields.iter().map(|(k, v)| (*k, v.as_str())).collect();

    // Step two, straight away: a minute later the printer refuses with error 70201.
    let response = client(DOWNLOAD_TIMEOUT)?
        .post(&content_url)
        .header(header::COOKIE, jar.header())
        .header(header::REFERER, &prepare_url)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form(&fields))
        .send()
        .await
        .map_err(|e| format!("Không tải được file: {e}"))?;
    let is_pdf = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/pdf"));
    if !response.status().is_success() || !is_pdf {
        // A refusal is a redirect to an error page that carries the code in its address.
        let code = response.url().as_str().split("errorcode=").nth(1).unwrap_or("").to_string();
        return Err(if code.is_empty() {
            "Máy in không trả về file PDF.".into()
        } else {
            format!("Máy in không trả về file PDF (mã lỗi {code}).")
        });
    }
    let bytes = response.bytes().await.map_err(|e| format!("Không tải được file: {e}"))?;

    tokio::fs::create_dir_all(folder)
        .await
        .map_err(|e| format!("Không tạo được thư mục lưu: {e}"))?;
    let path = free_path(folder, &file.name);
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("Không lưu được file: {e}"))?;
    Ok(Downloaded {
        path: path.to_string_lossy().into_owned(),
        bytes: bytes.len() as u64,
    })
}

/// The few entities Web Image Monitor writes in names and labels.
fn unescape(text: &str) -> String {
    text.replace("&#160;", " ")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The first `attr='…'` or `attr="…"` in `html`.
fn attribute<'a>(html: &'a str, attr: &str) -> Option<&'a str> {
    let start = html.find(&format!("{attr}="))? + attr.len() + 1;
    let quote = html[start..].chars().next()?;
    let rest = &html[start + 1..];
    Some(&rest[..rest.find(quote)?])
}

/// `alt` of every icon in this row, such as "Scanner" or "Full Color".
fn icons(row: &str) -> Vec<String> {
    row.match_indices("<img src=\"/images/icon")
        .filter_map(|(at, _)| attribute(&row[at..], "alt"))
        .map(unescape)
        .collect()
}

/// "Oct 30, 2026 11:47 PM" as the printer prints it, in its own time zone.
fn parse_created(text: &str) -> Option<String> {
    let time = jiff::civil::DateTime::strptime("%b %d, %Y %I:%M %p", text.trim()).ok()?;
    Some(time.to_string())
}

/// "SCAN0099 :   [Oct 30, 2026 11:47 PM  11Page(s)]" into name, time and pages.
fn parse_caption(caption: &str) -> (String, Option<String>, Option<u32>) {
    let caption = unescape(caption);
    let Some(open) = caption.rfind(" :   [") else {
        return (caption.trim().to_string(), None, None);
    };
    let name = caption[..open].trim().to_string();
    let inner = caption[open + 6..].trim_end_matches(']').trim();
    let (created, pages) = match inner.rfind("  ") {
        Some(split) => (&inner[..split], inner[split..].trim()),
        None => (inner, ""),
    };
    let pages = pages.strip_suffix("Page(s)").and_then(|n| n.trim().parse().ok());
    (name, parse_created(created), pages)
}

/// Reads the thumbnail view of a folder. None when the page is not a file list,
/// such as the "session timed out" page.
fn parse_list(html: &str) -> Option<StoredFiles> {
    let total_at = html.find("Total Files&#160;:&#160;")? + "Total Files&#160;:&#160;".len();
    let total = html[total_at..]
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()?;

    const MARK: &str = "name=\"displayedDocIds\" value=\"";
    let starts: Vec<usize> = html.match_indices(MARK).map(|(at, _)| at).collect();
    let mut files = Vec::new();
    for (i, &start) in starts.iter().enumerate() {
        let row = &html[start..starts.get(i + 1).copied().unwrap_or(html.len())];
        // The download form repeats every id; only rows in the list carry a thumbnail.
        let Some(thumb_at) = row.find("srcback=") else {
            continue;
        };
        let Some(doc_id) = attribute(row, "value") else {
            continue;
        };
        let image = &row[row[..thumb_at].rfind("<img")?..];
        let (name, created, pages) = parse_caption(attribute(image, "title").unwrap_or_default());
        let thumbnail_id = attribute(image, "srcback")
            .and_then(|url| url.split_once("id="))
            .map(|(_, id)| id.to_string());
        let mut icons = icons(row).into_iter();
        files.push(StoredFile {
            doc_id: doc_id.to_string(),
            name,
            created,
            pages,
            function: icons.next(),
            color: icons.next(),
            thumbnail_id,
        });
    }
    Some(StoredFiles { total, files })
}

#[tauri::command]
pub async fn list_stored_files(
    settings: State<'_, Settings>,
    docbox: State<'_, Docbox>,
) -> Result<StoredFiles, String> {
    let _walk = docbox.0.lock().await;
    list(&settings.get().host).await
}

/// Saves a file from the Shared Folder into the scan folder as PDF; the printer keeps its copy.
#[tauri::command]
pub async fn download_stored_file(
    doc_id: String,
    app: AppHandle,
    settings: State<'_, Settings>,
    docbox: State<'_, Docbox>,
) -> Result<Downloaded, String> {
    if doc_id.is_empty() || !doc_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Mã file không hợp lệ.".into());
    }
    let folder = scan_folder(&app, &settings)?;
    let _walk = docbox.0.lock().await;
    download(&settings.get().host, &doc_id, &folder).await
}

/// The JPEG the list page shows for a file.
#[tauri::command]
pub async fn get_stored_thumbnail(id: String, settings: State<'_, Settings>) -> Result<Response, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Mã ảnh thu nhỏ không hợp lệ.".into());
    }
    let url = format!("http://{}/DH/repository/thumbnail.jpg?id={id}", settings.get().host);
    let response = client(TIMEOUT)?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Máy in trả về {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = include_str!("fixtures/wim-shared-folder.html");
    const EMPTY: &str = include_str!("fixtures/wim-shared-folder-empty.html");
    const PREPARED: &str = include_str!("fixtures/wim-download-page.html");

    #[test]
    fn finds_each_files_pdf_link() {
        assert_eq!(
            download_link(LIST, "27719").as_deref(),
            Some("/web/guest/en/webdocbox/docListDownload.cgi?docId=MTU3MTE0MzQzMA==&docType=NTQ3Nw==")
        );
        assert_ne!(download_link(LIST, "27718"), download_link(LIST, "27719"));
        assert_eq!(download_link(LIST, "1"), None);
    }

    #[test]
    fn reads_the_prepared_files_address_and_fields() {
        let (url, fields) = content_request(PREPARED).unwrap();
        assert_eq!(url, "http://192.168.1.103/DH/repository/content/SCAN0100.pdf?");
        let names: Vec<&str> = fields.iter().map(|(k, _)| *k).collect();
        assert_eq!(names, ["id", "jt", "el", "browserTypeVal"]);
        assert!(fields[0].1.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(fields[1].1, "2");
        // The error page address keeps its own query, trailing "&" included.
        assert!(fields[2].1.starts_with("http://192.168.1.103/web/guest/en/webdocbox/webDocErrorPage.cgi?"));
        assert!(fields[2].1.ends_with('&'));
    }

    #[test]
    fn form_fields_are_percent_encoded() {
        assert_eq!(form(&[("el", "http://h/p.cgi?a=1&"), ("n", "4")]), "el=http%3A%2F%2Fh%2Fp.cgi%3Fa%3D1%26&n=4");
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let folder = std::env::temp_dir().join(format!("ricoh-hub-free-path-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(free_path(&folder, "SCAN0100"), folder.join("SCAN0100.pdf"));
        std::fs::write(folder.join("SCAN0100.pdf"), b"").unwrap();
        assert_eq!(free_path(&folder, "SCAN0100"), folder.join("SCAN0100 (2).pdf"));
        assert_eq!(free_path(&folder, "a/b"), folder.join("a-b.pdf"));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn reads_every_file_in_the_shared_folder() {
        let list = parse_list(LIST).unwrap();
        assert_eq!(list.total, 4);
        let names: Vec<&str> = list.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["SCAN0099", "SCAN0098", "SCAN0097", "SCAN0096"]);
        assert_eq!(
            list.files[0],
            StoredFile {
                doc_id: "27719".into(),
                name: "SCAN0099".into(),
                created: Some("2026-10-30T23:47:00".into()),
                pages: Some(11),
                function: Some("Scanner".into()),
                color: Some("Full Color".into()),
                thumbnail_id: Some("014373203298490".into()),
            }
        );
        assert_eq!(list.files[3].pages, Some(2));
    }

    #[test]
    fn an_empty_folder_is_a_list_with_no_files() {
        assert_eq!(
            parse_list(EMPTY),
            Some(StoredFiles {
                total: 0,
                files: Vec::new()
            })
        );
    }

    #[test]
    fn a_timed_out_session_is_not_an_empty_folder() {
        let page = "<html><title>Error</title><li>Session timed out.</li></html>";
        assert_eq!(parse_list(page), None);
    }

    #[test]
    fn a_caption_without_a_date_keeps_the_name() {
        assert_eq!(parse_caption("Hợp đồng &amp; phụ lục"), ("Hợp đồng & phụ lục".into(), None, None));
        assert_eq!(
            parse_caption("A : B :   [Jan 2, 2026 9:05 AM  1Page(s)]"),
            ("A : B".into(), Some("2026-01-02T09:05:00".into()), Some(1))
        );
    }

    /// Lists the real Shared Folder; reads only, like opening the page in a browser:
    /// `RICOH_HOST=192.168.1.103 cargo test live_docbox -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "needs a printer on the network"]
    async fn live_docbox_lists_the_shared_folder() {
        let host = std::env::var("RICOH_HOST").unwrap_or_else(|_| "192.168.1.103".into());
        println!("{}", serde_json::to_string_pretty(&list(&host).await.unwrap()).unwrap());
    }

    /// Downloads the newest file in the Shared Folder into a temp folder, then checks the
    /// printer still has it. Needs RICOH_DOWNLOAD=<file name> so only a chosen test scan is touched:
    /// `RICOH_DOWNLOAD=SCAN0100 cargo test live_docbox_download -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "downloads from the real printer"]
    async fn live_docbox_download_keeps_the_file() {
        let Ok(name) = std::env::var("RICOH_DOWNLOAD") else {
            return;
        };
        let host = std::env::var("RICOH_HOST").unwrap_or_else(|_| "192.168.1.103".into());
        let before = list(&host).await.unwrap();
        let file = before.files.iter().find(|f| f.name == name).expect("the test scan is listed");
        let folder = std::env::temp_dir().join(format!("ricoh-hub-download-{}", std::process::id()));
        let saved = download(&host, &file.doc_id, &folder).await.unwrap();
        let bytes = std::fs::read(&saved.path).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        println!("{} ({} bytes)", saved.path, saved.bytes);
        let after = list(&host).await.unwrap();
        assert!(after.files.iter().any(|f| f.doc_id == file.doc_id), "the printer kept its copy");
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
