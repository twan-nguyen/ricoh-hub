import { create } from "zustand";

import {
  type PrinterSettings,
  type Snapshot,
  getSettings,
  getSnapshot,
  saveSettings,
} from "@/lib/printer";
import { errorMessage } from "@/lib/utils";

export type View = "overview" | "counters" | "jobs" | "settings";

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

  init: () => () => void;
  setView: (view: View) => void;
  refresh: () => Promise<void>;
  saveSettings: (settings: PrinterSettings) => Promise<void>;
};

export const useStore = create<State>()((set, get) => ({
  view: "overview",
  settings: null,
  snapshot: null,
  updatedAt: null,
  error: null,
  loading: false,

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
}));
