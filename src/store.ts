import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import {
  type PrintOptions,
  type PrinterSettings,
  type PrinterStatus,
  type ScanOptions,
  type Snapshot,
  type SubmittedJob,
  cancelJob,
  cancelScan,
  disconnectPrinter,
  getSettings,
  getStatus,
  printFile,
  refreshPrinter,
  saveSettings,
  startScan,
} from "@/lib/printer";
import { errorMessage } from "@/lib/utils";

export type View = "overview" | "print" | "scan" | "jobs" | "counters" | "stats" | "settings";

export type ScanFile = { path: string; bytes: number };

type State = {
  view: View;
  settings: PrinterSettings | null;
  /** The address given up on last, offered again so a typo can be fixed. */
  lastHost: string | null;
  snapshot: Snapshot | null;
  /** When the snapshot on screen was read. */
  updatedAt: number | null;
  /** The last read failed; the previous snapshot, if any, stays on screen. */
  error: string | null;
  /** A reading is under way. */
  loading: boolean;
  /** The file waiting to be printed, picked or dropped on the window. */
  document: string | null;
  /** A file is being dragged over the window. */
  dragging: boolean;
  /** Kept here so a scan carries on while another view is open. */
  scanning: boolean;
  /** Files saved by the running or the last scan. */
  scanFiles: ScanFile[];
  scanError: string | null;

  init: () => () => void;
  setView: (view: View) => void;
  refresh: () => Promise<void>;
  saveSettings: (settings: PrinterSettings) => Promise<void>;
  connect: (host: string, community: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setDocument: (path: string | null) => void;
  setDragging: (dragging: boolean) => void;
  print: (options: PrintOptions) => Promise<SubmittedJob>;
  cancelJob: (jobId: number) => Promise<void>;
  scan: (options: ScanOptions) => Promise<void>;
  cancelScan: () => Promise<void>;
};

export const useStore = create<State>()((set, get) => ({
  view: "overview",
  settings: null,
  lastHost: null,
  snapshot: null,
  updatedAt: null,
  error: null,
  loading: false,
  document: null,
  dragging: false,
  scanning: false,
  scanFiles: [],
  scanError: null,

  init() {
    getSettings().then((settings) => set({ settings }));
    // The Rust side reads the printer on its own timer, also while the window is hidden.
    const show = (status: PrinterStatus) =>
      set({
        snapshot: status.snapshot,
        updatedAt: status.updatedAt,
        error: status.error,
        loading: status.reading,
      });
    getStatus().then(show);
    const listening = [
      listen<PrinterStatus>("printer-status", (event) => show(event.payload)),
      // "In tài liệu…" in the menu bar opens the window on a view.
      listen<View>("navigate", (event) => set({ view: event.payload })),
    ];
    // Coming back to the window should not show numbers up to ten seconds old.
    const onFocus = () => get().refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      for (const unlisten of listening) unlisten.then((stop) => stop());
      window.removeEventListener("focus", onFocus);
    };
  },

  setView: (view) => set({ view }),

  refresh: () => refreshPrinter(),

  async saveSettings(next) {
    // A new address clears the old printer's numbers on the Rust side, which then reads the new one.
    set({ settings: await saveSettings(next) });
  },

  async connect(host, community) {
    const { settings, saveSettings } = get();
    if (settings) await saveSettings({ ...settings, host, community });
  },

  async disconnect() {
    const lastHost = get().settings?.host || null;
    set({ settings: await disconnectPrinter(), lastHost });
  },

  setDocument: (document) => set({ document }),
  setDragging: (dragging) => set({ dragging }),

  async print(options) {
    const { document } = get();
    if (!document) throw new Error("Chưa chọn file để in.");
    const job = await printFile(document, options);
    set({ document: null });
    // The new job shows up in Lệnh in only after the printer is read again.
    get().refresh();
    return job;
  },

  async cancelJob(jobId) {
    await cancelJob(jobId);
    await get().refresh();
  },

  async scan(options) {
    if (get().scanning) return;
    set({ scanning: true, scanFiles: [], scanError: null });
    try {
      await startScan(options, (event) => {
        if (event.kind === "saved") {
          set((s) => ({ scanFiles: [...s.scanFiles, { path: event.path, bytes: event.bytes }] }));
        }
      });
    } catch (err) {
      set({ scanError: errorMessage(err) });
    } finally {
      set({ scanning: false });
    }
  },

  cancelScan: () => cancelScan(),
}));
