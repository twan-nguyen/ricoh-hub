use std::{fs, path::Path, sync::Mutex};

use jiff::{Timestamp, ToSpan, civil::Date, tz::TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{settings::Settings, snapshot::Snapshot};

/// A reading is kept when a number moved, and at least this often while the app runs,
/// so a day without printing still shows the app was watching.
const KEEP_EVERY_MS: i64 = 15 * 60 * 1000;

/// Counters by Ricoh's names, the same ones the dashboard leads with (`KEY_COUNTERS` in `src/lib/format.ts`).
const TOTAL: &str = "Counter: Machine Total";
const PRINT: &str = "Counter:Print:Total";
const COPY: &str = "Counter:Copy:Total";
const FAX: &str = "Counter:FAX:Total";
const SCANNED: &str = "Scanned Pages: Total";
const DUPLEX: &str = "No. of Printed Sides in Duplex";
const LARGE: &str = "Large Paper Prints: >=A3,DLT";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS readings (
    host TEXT NOT NULL,
    at INTEGER NOT NULL,
    total INTEGER,
    print INTEGER,
    copy INTEGER,
    fax INTEGER,
    scanned INTEGER,
    duplex INTEGER,
    large INTEGER,
    toner INTEGER
);
CREATE INDEX IF NOT EXISTS readings_by_host_and_time ON readings (host, at);
PRAGMA user_version = 1;
";

/// The printer's cumulative counters at one moment; `at` is in milliseconds since the epoch.
#[derive(Clone, Debug, Default, PartialEq)]
struct Reading {
    at: i64,
    total: Option<i64>,
    print: Option<i64>,
    copy: Option<i64>,
    fax: Option<i64>,
    scanned: Option<i64>,
    duplex: Option<i64>,
    large: Option<i64>,
    toner: Option<i32>,
}

impl Reading {
    fn from_snapshot(snapshot: &Snapshot, at: i64) -> Self {
        let counter = |name: &str| snapshot.counters.iter().find(|c| c.name == name).map(|c| c.value);
        Self {
            at,
            total: counter(TOTAL),
            print: counter(PRINT),
            copy: counter(COPY),
            fax: counter(FAX),
            scanned: counter(SCANNED),
            duplex: counter(DUPLEX),
            large: counter(LARGE),
            toner: snapshot.toner,
        }
    }

    fn same_numbers(&self, other: &Reading) -> bool {
        Reading { at: 0, ..self.clone() } == Reading { at: 0, ..other.clone() }
    }

    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            at: row.get(0)?,
            total: row.get(1)?,
            print: row.get(2)?,
            copy: row.get(3)?,
            fax: row.get(4)?,
            scanned: row.get(5)?,
            duplex: row.get(6)?,
            large: row.get(7)?,
            toner: row.get(8)?,
        })
    }
}

const COLUMNS: &str = "at, total, print, copy, fax, scanned, duplex, large, toner";

/// Pages for one day, or one month in the yearly view.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    /// "2026-11-04", or "2026-11" for a month.
    date: String,
    /// None when the app read nothing that day.
    total: Option<i64>,
    print: Option<i64>,
    copy: Option<i64>,
    fax: Option<i64>,
    /// The last toner level read that day.
    toner: Option<i32>,
    /// Set when the count does not start at the previous day's close: then it runs
    /// from the last reading before days the app was off, or from the day's first reading.
    since: Option<i64>,
}

fn delta(open: Option<i64>, close: Option<i64>) -> Option<i64> {
    // A counter going down was reset or replaced; that day counts nothing rather than less than nothing.
    Some((close? - open?).max(0))
}

fn start_ms(day: Date, tz: &TimeZone) -> i64 {
    day.to_zoned(tz.clone()).map(|z| z.timestamp().as_millisecond()).unwrap_or(i64::MAX)
}

/// Pages per day from `first` to `last`: each day's last reading minus the one before it.
/// `baseline` is the last reading before `first`; `rows` are the readings from `first` on, oldest first.
fn days(baseline: Option<Reading>, rows: &[Reading], first: Date, last: Date, tz: &TimeZone) -> Vec<Bucket> {
    let mut buckets = Vec::new();
    let mut previous = baseline;
    let mut next = 0;
    let mut day = first;
    while day <= last {
        let Ok(tomorrow) = day.tomorrow() else { break };
        let start = start_ms(day, tz);
        let end = start_ms(tomorrow, tz);
        let from = next;
        while next < rows.len() && rows[next].at < end {
            next += 1;
        }
        let today = &rows[from..next];

        let mut bucket = Bucket {
            date: day.to_string(),
            total: None,
            print: None,
            copy: None,
            fax: None,
            toner: None,
            since: None,
        };
        if let Some(close) = today.last() {
            let yesterday = day.yesterday().map(|d| start_ms(d, tz)).unwrap_or(start);
            let (open, since) = match &previous {
                Some(p) if p.at >= yesterday => (p, None),
                // The app was off for a while: those days' pages land here.
                Some(p) => (p, Some(p.at)),
                // The first day the app ever saw: count from its first reading.
                None => (&today[0], Some(today[0].at)),
            };
            bucket.total = delta(open.total, close.total);
            bucket.print = delta(open.print, close.print);
            bucket.copy = delta(open.copy, close.copy);
            bucket.fax = delta(open.fax, close.fax);
            bucket.toner = close.toner;
            bucket.since = since;
            previous = Some(close.clone());
        }
        buckets.push(bucket);
        day = tomorrow;
    }
    buckets
}

fn add(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    }
}

/// Folds days into calendar months.
fn months(days: Vec<Bucket>) -> Vec<Bucket> {
    let mut months: Vec<Bucket> = Vec::new();
    for day in days {
        let month = day.date[..7].to_string();
        match months.last_mut() {
            Some(m) if m.date == month => {
                m.total = add(m.total, day.total);
                m.print = add(m.print, day.print);
                m.copy = add(m.copy, day.copy);
                m.fax = add(m.fax, day.fax);
                m.toner = day.toner.or(m.toner);
                m.since = m.since.or(day.since);
            }
            _ => months.push(Bucket { date: month, ..day }),
        }
    }
    months
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Range {
    /// The last 7 days, by day.
    Week,
    /// The last 30 days, by day.
    Month,
    /// The last 12 months, by month.
    Year,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryView {
    buckets: Vec<Bucket>,
    /// The first reading kept for this printer; the charts are thin until it is a few days old.
    first_at: Option<i64>,
}

pub struct History {
    db: Mutex<Connection>,
    /// The last reading written, to skip readings that change nothing.
    last: Mutex<Option<(String, Reading)>>,
}

impl History {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Self::with(Connection::open(path).map_err(|e| e.to_string())?)
    }

    fn with(db: Connection) -> Result<Self, String> {
        db.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(Self { db: Mutex::new(db), last: Mutex::new(None) })
    }

    pub fn record(&self, host: &str, snapshot: &Snapshot) -> Result<(), String> {
        self.insert(host, Reading::from_snapshot(snapshot, Timestamp::now().as_millisecond()))
    }

    fn insert(&self, host: &str, reading: Reading) -> Result<(), String> {
        let mut last = self.last.lock().unwrap();
        if let Some((last_host, previous)) = last.as_ref()
            && last_host == host
            && previous.same_numbers(&reading)
            && reading.at - previous.at < KEEP_EVERY_MS
        {
            return Ok(());
        }
        self.db
            .lock()
            .unwrap()
            .execute(
                &format!("INSERT INTO readings (host, {COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
                params![
                    host,
                    reading.at,
                    reading.total,
                    reading.print,
                    reading.copy,
                    reading.fax,
                    reading.scanned,
                    reading.duplex,
                    reading.large,
                    reading.toner
                ],
            )
            .map_err(|e| e.to_string())?;
        *last = Some((host.to_string(), reading));
        Ok(())
    }

    /// The last reading before `from`, and every reading from `from` on, oldest first.
    fn readings(&self, host: &str, from: i64) -> rusqlite::Result<(Option<Reading>, Vec<Reading>)> {
        let db = self.db.lock().unwrap();
        let baseline = db
            .query_row(
                &format!("SELECT {COLUMNS} FROM readings WHERE host = ?1 AND at < ?2 ORDER BY at DESC LIMIT 1"),
                params![host, from],
                Reading::from_row,
            )
            .optional()?;
        let rows = db
            .prepare(&format!("SELECT {COLUMNS} FROM readings WHERE host = ?1 AND at >= ?2 ORDER BY at"))?
            .query_map(params![host, from], Reading::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((baseline, rows))
    }

    fn first_at(&self, host: &str) -> rusqlite::Result<Option<i64>> {
        self.db
            .lock()
            .unwrap()
            .query_row("SELECT MIN(at) FROM readings WHERE host = ?1", params![host], |row| row.get(0))
    }

    fn view(&self, host: &str, range: Range, today: Date, tz: &TimeZone) -> rusqlite::Result<HistoryView> {
        let first = match range {
            Range::Week => today.checked_sub(6.days()),
            Range::Month => today.checked_sub(29.days()),
            Range::Year => today.first_of_month().checked_sub(11.months()),
        }
        .unwrap_or(today);
        let (baseline, rows) = self.readings(host, start_ms(first, tz))?;
        let buckets = days(baseline, &rows, first, today, tz);
        Ok(HistoryView {
            buckets: if matches!(range, Range::Year) { months(buckets) } else { buckets },
            first_at: self.first_at(host)?,
        })
    }
}

fn now() -> (Date, TimeZone) {
    let tz = TimeZone::system();
    (Timestamp::now().to_zoned(tz.clone()).date(), tz)
}

fn unreadable(error: rusqlite::Error) -> String {
    format!("Không đọc được lịch sử: {error}")
}

#[tauri::command]
pub fn get_history(
    range: Range,
    history: State<'_, History>,
    settings: State<'_, Settings>,
) -> Result<HistoryView, String> {
    let (today, tz) = now();
    history.view(&settings.get().host, range, today, &tz).map_err(unreadable)
}

/// Today's pages, for the dashboard.
#[tauri::command]
pub fn get_pages_today(history: State<'_, History>, settings: State<'_, Settings>) -> Result<Bucket, String> {
    let (today, tz) = now();
    let (baseline, rows) = history.readings(&settings.get().host, start_ms(today, &tz)).map_err(unreadable)?;
    Ok(days(baseline, &rows, today, today, &tz).remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 60 * 60 * 1000;

    fn date(text: &str) -> Date {
        text.parse().unwrap()
    }

    /// Readings in UTC, so a day starts at a round number of milliseconds.
    fn at(day: &str, hour: i64) -> i64 {
        start_ms(date(day), &TimeZone::UTC) + hour * HOUR
    }

    fn reading(at: i64, print: i64, copy: i64) -> Reading {
        Reading {
            at,
            total: Some(print + copy),
            print: Some(print),
            copy: Some(copy),
            fax: Some(0),
            toner: Some(40),
            ..Reading::default()
        }
    }

    fn totals(buckets: &[Bucket]) -> Vec<Option<i64>> {
        buckets.iter().map(|b| b.total).collect()
    }

    #[test]
    fn a_day_counts_from_the_previous_days_close() {
        let baseline = reading(at("2026-11-02", 17), 1000, 500);
        let rows = [
            reading(at("2026-11-03", 9), 1010, 500),
            reading(at("2026-11-03", 17), 1040, 520),
            reading(at("2026-11-04", 10), 1045, 520),
        ];
        let buckets = days(Some(baseline), &rows, date("2026-11-03"), date("2026-11-04"), &TimeZone::UTC);
        assert_eq!(totals(&buckets), [Some(60), Some(5)]);
        assert_eq!((buckets[0].print, buckets[0].copy), (Some(40), Some(20)));
        assert!(buckets.iter().all(|b| b.since.is_none()));
    }

    #[test]
    fn days_without_readings_stay_empty_and_the_next_one_is_marked() {
        let baseline = reading(at("2026-10-30", 17), 1000, 500);
        let rows = [reading(at("2026-11-02", 9), 1100, 500)];
        let buckets = days(Some(baseline.clone()), &rows, date("2026-10-31"), date("2026-11-02"), &TimeZone::UTC);
        assert_eq!(totals(&buckets), [None, None, Some(100)]);
        assert_eq!(buckets[2].since, Some(baseline.at));
    }

    #[test]
    fn the_first_day_counts_from_its_first_reading() {
        let rows = [reading(at("2026-11-04", 8), 1000, 500), reading(at("2026-11-04", 12), 1030, 500)];
        let buckets = days(None, &rows, date("2026-11-04"), date("2026-11-04"), &TimeZone::UTC);
        assert_eq!(buckets[0].total, Some(30));
        assert_eq!(buckets[0].since, Some(rows[0].at));
    }

    #[test]
    fn a_counter_that_goes_down_counts_nothing() {
        let baseline = reading(at("2026-11-03", 17), 1000, 500);
        let rows = [reading(at("2026-11-04", 9), 10, 5)];
        let buckets = days(Some(baseline), &rows, date("2026-11-04"), date("2026-11-04"), &TimeZone::UTC);
        assert_eq!(buckets[0].total, Some(0));
    }

    #[test]
    fn months_add_their_days() {
        let baseline = reading(at("2026-09-30", 17), 1000, 500);
        let rows = [
            reading(at("2026-10-01", 17), 1010, 500),
            reading(at("2026-10-31", 17), 1030, 510),
            reading(at("2026-11-01", 17), 1031, 510),
        ];
        let months = months(days(Some(baseline), &rows, date("2026-10-01"), date("2026-11-01"), &TimeZone::UTC));
        assert_eq!(months.iter().map(|m| m.date.as_str()).collect::<Vec<_>>(), ["2026-10", "2026-11"]);
        assert_eq!(totals(&months), [Some(40), Some(1)]);
        // October 31 follows a month of empty days, so the month carries the mark.
        assert!(months[0].since.is_some());
    }

    #[test]
    fn unchanged_readings_are_kept_only_every_fifteen_minutes() {
        let history = History::with(Connection::open_in_memory().unwrap()).unwrap();
        let start = at("2026-11-04", 9);
        for minutes in [0, 1, 2, 16] {
            history.insert("printer", reading(start + minutes * 60_000, 1000, 500)).unwrap();
        }
        history.insert("printer", reading(start + 17 * 60_000, 1001, 500)).unwrap();
        // Another printer's readings never mix in.
        history.insert("other", reading(start, 5, 5)).unwrap();

        let (baseline, rows) = history.readings("printer", start).unwrap();
        assert!(baseline.is_none());
        assert_eq!(rows.iter().map(|r| (r.at - start) / 60_000).collect::<Vec<_>>(), [0, 16, 17]);
        assert_eq!(rows[2], reading(start + 17 * 60_000, 1001, 500));

        let view = history.view("printer", Range::Week, date("2026-11-04"), &TimeZone::UTC).unwrap();
        assert_eq!(view.buckets.len(), 7);
        assert_eq!(view.buckets[6].total, Some(1));
        assert_eq!(view.first_at, Some(start));
    }
}
