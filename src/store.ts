import { create } from "zustand";

import {
  type PrintOptions,
  type PrinterSettings,
  type ScanOptions,
  type Snapshot,
  type SubmittedJob,
  cancelJob,
  cancelScan,
  getSettings,
  getSnapshot,
  printFile,
  saveSettings,
  startScan,
} from "@/lib/printer";
import { errorMessage } from "@/lib/utils";

export type View = "overview" | "print" | "scan" | "jobs" | "counters" | "settings";

export type ScanFile = { path: string; bytes: number };

/** How often the printer is asked again while the window is open. */
const REFRESH_MS = 10_000;

type State = {
  view: View;
  settings: PrinterSettings | null;
  snapshot: Snapshot | null;
  /** When the snapshot on screen was read. */
  updatedAt: number | null;
  /** The last read failed; the previous snapshot, if any, stays on screen. */
  error: string | null;
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
    get().refresh();
    const timer = setInterval(() => get().refresh(), REFRESH_MS);
    // Coming back to the window should not show numbers up to ten seconds old.
    const onFocus = () => get().refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  },

  setView: (view) => set({ view }),

  async refresh() {
    // A printer waking from Energy Saver can be slow; never stack reads on it.
    if (get().loading) return;
    set({ loading: true });
    try {
      const snapshot = await getSnapshot();
      set({ snapshot, updatedAt: Date.now(), error: null });
    } catch (err) {
      set({ error: errorMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  async saveSettings(next) {
    const settings = await saveSettings(next);
    // Numbers from the old address must not pass for the new printer's.
    set({ settings, snapshot: null, updatedAt: null, error: null });
    await get().refresh();
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
