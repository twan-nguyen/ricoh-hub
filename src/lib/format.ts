import { useEffect, useState } from "react";

import type { Counter, Snapshot, Tray } from "@/lib/printer";

export type StatusTone = "ok" | "done" | "pending" | "failed" | "unknown";

/** Current time, refreshed on an interval so relative times stay fresh. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const numbers = new Intl.NumberFormat("vi-VN");

/** 61188 → "61.188", as Vietnamese readers group digits. */
export const formatNumber = (value: number) => numbers.format(value);

/** File sizes as Finder shows them: "820 KB", "2,4 MB". */
export function formatBytes(bytes: number) {
  if (bytes < 1000 * 1000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1000 / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
}

/** "vừa xong", "12 giây trước", "3 phút trước". */
export function formatAgo(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return "vừa xong";
  if (seconds < 60) return `${seconds} giây trước`;
  return `${Math.floor(seconds / 60)} phút trước`;
}

/** "38 ngày 4 giờ", or "4 giờ 12 phút" under a day. */
export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

const PRINTER_STATES: Record<number, { label: string; tone: StatusTone }> = {
  3: { label: "Sẵn sàng", tone: "ok" },
  4: { label: "Đang in", tone: "pending" },
  5: { label: "Đã dừng", tone: "failed" },
};

export const printerState = (state: number) =>
  PRINTER_STATES[state] ?? { label: "Không rõ", tone: "unknown" as StatusTone };

/** IPP printer-state-reasons, without their -error/-warning/-report suffix. */
const REASONS: Record<string, string> = {
  "media-low": "Giấy sắp hết ở một khay",
  "media-empty": "Một khay đã hết giấy",
  "media-needed": "Máy cần nạp giấy",
  "media-jam": "Kẹt giấy",
  "toner-low": "Mực sắp hết",
  "toner-empty": "Hết mực",
  "marker-supply-low": "Mực sắp hết",
  "marker-supply-empty": "Hết mực",
  "marker-waste-almost-full": "Hộp mực thải sắp đầy",
  "marker-waste-full": "Hộp mực thải đã đầy",
  "door-open": "Cửa máy đang mở",
  "cover-open": "Nắp máy đang mở",
  "input-tray-missing": "Thiếu khay giấy",
  "output-area-almost-full": "Khay ra giấy sắp đầy",
  "output-area-full": "Khay ra giấy đã đầy",
  "output-tray-missing": "Thiếu khay ra giấy",
  paused: "Máy in đang tạm dừng",
  offline: "Máy in đang ngoại tuyến",
  "spool-area-full": "Bộ nhớ lệnh in đã đầy",
  "timed-out": "Máy in không phản hồi",
  shutdown: "Máy in đang tắt",
  other: "Máy in báo một lỗi khác",
};

export type Issue = { key: string; label: string; tone: StatusTone };

/** Reasons the printer gives, worded for people; reports are kept out as noise. */
export function issues(reasons: string[]): Issue[] {
  return reasons.flatMap((reason) => {
    const match = reason.match(/^(.*?)(?:-(error|warning|report))?$/);
    const base = match?.[1] ?? reason;
    const severity = match?.[2];
    if (severity === "report") return [];
    return [
      {
        key: reason,
        label: REASONS[base] ?? reason,
        // RFC 8011: a reason without a suffix is an error.
        tone: severity === "warning" ? "pending" : "failed",
      },
    ];
  });
}

/** The control panel's English messages, in plain Vietnamese; unknown ones pass through. */
const PANEL_MESSAGES: Record<string, string> = {
  "Energy Saver Mode": "Đang ở chế độ tiết kiệm điện",
  "Warming Up...": "Đang khởi động",
  Ready: "Sẵn sàng",
  Printing: "Đang in",
};

export const panelMessage = (text: string) => PANEL_MESSAGES[text] ?? text;

/** Short and long sides in millimetres, with a couple of mm of slack for rounding. */
const PAPER_SIZES: [string, number, number][] = [
  ["A3", 297, 420],
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["A6", 105, 148],
  ["B4", 257, 364],
  ["B5", 182, 257],
  ["Letter", 216, 279],
  ["Legal", 216, 356],
  ["Ledger", 279, 432],
];

export function paperSize(tray: Tray) {
  const match = PAPER_SIZES.find(
    ([, w, h]) => Math.abs(w - tray.widthMm) <= 2 && Math.abs(h - tray.heightMm) <= 2,
  );
  return match?.[0] ?? `${tray.widthMm}×${tray.heightMm} mm`;
}

/** "Tray 1" → "Khay 1", "Bypass Tray" → "Khay tay". */
export function trayName(tray: Tray) {
  if (tray.manual) return "Khay tay";
  return tray.name.replace(/^Tray\s*(\d+)$/, "Khay $1");
}

/** Below this share of its capacity a tray reads as running low. */
const LOW_PAPER = 0.15;

export function trayStatus(tray: Tray): { label: string; tone: StatusTone; fill: number | null } {
  if (tray.level === -2) return { label: "Không rõ", tone: "unknown", fill: null };
  if (tray.level === -3) return { label: "Còn giấy", tone: "ok", fill: null };
  const fill = tray.capacity > 0 ? Math.min(1, tray.level / tray.capacity) : null;
  if (tray.level === 0 || !tray.available) {
    // The bypass tray is loaded by hand for one job, so empty is its resting state.
    return tray.manual
      ? { label: "Trống", tone: "done", fill: 0 }
      : { label: "Hết giấy", tone: "failed", fill: 0 };
  }
  if (fill !== null && fill <= LOW_PAPER) return { label: "Sắp hết", tone: "pending", fill };
  return { label: "Đủ giấy", tone: "ok", fill };
}

/** Toner: what the printer says first, then the level for when it says nothing. */
export function tonerStatus(snapshot: Snapshot): { label: string; tone: StatusTone } {
  const has = (...names: string[]) =>
    snapshot.reasons.some((r) => names.some((n) => r.startsWith(n)));
  if (has("toner-empty", "marker-supply-empty")) return { label: "Hết mực", tone: "failed" };
  if (has("toner-low", "marker-supply-low")) return { label: "Sắp hết", tone: "pending" };
  if (snapshot.toner === null) return { label: "Không rõ", tone: "unknown" };
  if (snapshot.toner <= 10) return { label: "Sắp hết", tone: "pending" };
  return { label: "Bình thường", tone: "ok" };
}

/**
 * The waste bottle's level is not reported in a usable way (it reads 100 of 100
 * while the printer calls it fine), so only the printer's own warnings count.
 */
export function wasteStatus(snapshot: Snapshot): { label: string; tone: StatusTone } {
  if (snapshot.reasons.some((r) => r.startsWith("marker-waste-full")))
    return { label: "Đã đầy, cần thay", tone: "failed" };
  if (snapshot.reasons.some((r) => r.startsWith("marker-waste-almost-full")))
    return { label: "Sắp đầy", tone: "pending" };
  return { label: "Bình thường", tone: "ok" };
}

/**
 * The counters the printer's own Counter page leads with, found by Ricoh's names.
 * Print, copy and fax add up to the machine total, so they split it in the chart.
 */
const KEY_COUNTERS = {
  total: ["Counter: Machine Total", "Tổng số trang"],
  print: ["Counter:Print:Total", "In"],
  copy: ["Counter:Copy:Total", "Photocopy"],
  fax: ["Counter:FAX:Total", "Fax"],
  scanned: ["Scanned Pages: Total", "Trang đã quét"],
  large: ["Large Paper Prints: >=A3,DLT", "Khổ A3 trở lên"],
  duplex: ["No. of Printed Sides in Duplex", "Mặt in 2 mặt"],
} as const;

export type CounterKey = keyof typeof KEY_COUNTERS;

export const counterLabel = (key: CounterKey) => KEY_COUNTERS[key][1];

/** The key counters the printer reported; a firmware without one leaves it out. */
export function keyCounters(counters: Counter[]): Partial<Record<CounterKey, number>> {
  const values: Partial<Record<CounterKey, number>> = {};
  for (const [key, [name]] of Object.entries(KEY_COUNTERS)) {
    const counter = counters.find((c) => c.name === name);
    if (counter) values[key as CounterKey] = counter.value;
  }
  return values;
}

const JOB_STATES: Record<number, { label: string; tone: StatusTone }> = {
  3: { label: "Đang chờ", tone: "pending" },
  4: { label: "Bị giữ lại", tone: "pending" },
  5: { label: "Đang in", tone: "pending" },
  6: { label: "Tạm dừng", tone: "pending" },
  7: { label: "Đã hủy", tone: "done" },
  8: { label: "Lỗi", tone: "failed" },
  9: { label: "Hoàn tất", tone: "ok" },
};

export const jobState = (state: number) =>
  JOB_STATES[state] ?? { label: "Không rõ", tone: "unknown" as StatusTone };
