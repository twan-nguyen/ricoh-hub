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

export const getSnapshot = () => invoke<Snapshot>("get_snapshot");

export const getSettings = () => invoke<PrinterSettings>("get_settings");

export const saveSettings = (settings: PrinterSettings) =>
  invoke<PrinterSettings>("save_settings", settings);
