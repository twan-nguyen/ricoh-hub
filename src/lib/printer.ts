import { invoke } from "@tauri-apps/api/core";

export type PrinterSettings = {
  host: string;
  community: string;
};

export type Tray = {
  name: string;
  /** The bypass tray: fed by hand, so empty is its normal state. */
  manual: boolean;
  widthMm: number;
  heightMm: number;
  capacity: number;
  /** Sheets left; -2 unknown, -3 "some". */
  level: number;
  available: boolean;
};

export type Counter = { index: number; name: string; value: number };

export type Job = {
  id: number;
  name: string | null;
  user: string | null;
  /** RFC 8011 job-state: 3 pending … 9 completed. */
  state: number;
  pages: number | null;
  created: string | null;
};

export type Snapshot = {
  host: string;
  model: string | null;
  name: string | null;
  serial: string | null;
  firmware: string | null;
  uptimeSeconds: number | null;
  /** IPP printer-state: 3 idle, 4 processing, 5 stopped. */
  state: number;
  reasons: string[];
  alerts: string[];
  display: string | null;
  toner: number | null;
  trays: Tray[];
  counters: Counter[];
  jobs: Job[];
};

export type Sides = "one-sided" | "two-sided-long-edge" | "two-sided-short-edge";

/** IPP `media-source`; "manual" is the bypass tray. */
export type TraySource = "auto" | "tray-1" | "tray-2" | "manual";

export type PrintOptions = {
  copies: number;
  sides: Sides;
  tray: TraySource;
  /** "1-3, 5", or empty for every page. */
  pages: string;
};

export type SubmittedJob = { id: number; name: string };

/** Extensions the printer reads itself; anything else has to become a PDF first. */
export const PRINTABLE_EXTENSIONS = ["pdf", "jpg", "jpeg", "ps"];

export const getSnapshot = () => invoke<Snapshot>("get_snapshot");

export const printFile = (path: string, options: PrintOptions) =>
  invoke<SubmittedJob>("print_file", { path, options });

export const cancelJob = (jobId: number) => invoke<void>("cancel_job", { jobId });

export const getSettings = () => invoke<PrinterSettings>("get_settings");

export const saveSettings = (settings: PrinterSettings) =>
  invoke<PrinterSettings>("save_settings", settings);
