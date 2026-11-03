import { Channel, invoke } from "@tauri-apps/api/core";

export type PrinterSettings = {
  host: string;
  community: string;
  /** Where scans are saved; null means Downloads/Ricoh Scans. */
  scanFolder: string | null;
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

/** What the scanner offers, read from eSCL ScannerCapabilities. */
export type ScannerCapabilities = {
  version: string;
  hasFeeder: boolean;
  feederDuplex: boolean;
  colorModes: string[];
  resolutions: number[];
  formats: string[];
  maxWidthMm: number;
  maxHeightMm: number;
};

export type ScannerStatus = {
  /** Idle, Processing, Testing or Stopped. */
  state: string;
  /** ScannerAdfLoaded, ScannerAdfEmpty, ScannerAdfJam…; null without a feeder. */
  adfState: string | null;
};

export type ScanSource = "Platen" | "Feeder";
export type ColorMode = "BlackAndWhite1" | "Grayscale8" | "RGB24";
export type ScanFormat = "application/pdf" | "image/jpeg";

export type ScanOptions = {
  source: ScanSource;
  duplex: boolean;
  colorMode: ColorMode;
  resolution: number;
  widthMm: number;
  heightMm: number;
  format: ScanFormat;
};

export type ScanEvent = { kind: "started" } | { kind: "saved"; path: string; bytes: number };

export const getScanner = () => invoke<ScannerCapabilities>("get_scanner");

export const getScannerStatus = () => invoke<ScannerStatus>("get_scanner_status");

export const getScanFolder = () => invoke<string>("get_scan_folder");

export function startScan(options: ScanOptions, onEvent: (event: ScanEvent) => void) {
  const onProgress = new Channel<ScanEvent>();
  onProgress.onmessage = onEvent;
  return invoke<string[]>("start_scan", { options, onProgress });
}

export const cancelScan = () => invoke<void>("cancel_scan");

export const openScan = (path: string) => invoke<void>("open_scan", { path });

export const revealScan = (path: string) => invoke<void>("reveal_scan", { path });

export const getSettings = () => invoke<PrinterSettings>("get_settings");

export const saveSettings = (settings: PrinterSettings) =>
  invoke<PrinterSettings>("save_settings", settings);
