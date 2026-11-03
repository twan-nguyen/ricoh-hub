import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";

import { CountersView } from "@/components/counters-view";
import { JobsView } from "@/components/jobs-view";
import { OverviewView } from "@/components/overview-view";
import { PrintView } from "@/components/print-view";
import { ScanView } from "@/components/scan-view";
import { SettingsView } from "@/components/settings-view";
import { Sidebar } from "@/components/sidebar";
import { type View, useStore } from "@/store";

const VIEWS: Record<View, () => React.ReactNode> = {
  overview: () => <OverviewView />,
  print: () => <PrintView />,
  scan: () => <ScanView />,
  jobs: () => <JobsView />,
  counters: () => <CountersView />,
  settings: () => <SettingsView />,
};

function App() {
  const init = useStore((s) => s.init);
  const view = useStore((s) => s.view);

  useEffect(() => init(), [init]);

  // A file dropped anywhere on the window is meant for printing.
  useEffect(() => {
    const listening = getCurrentWebview().onDragDropEvent(({ payload }) => {
      const { setDragging, setDocument, setView } = useStore.getState();
      if (payload.type === "enter" || payload.type === "over") {
        setDragging(true);
      } else if (payload.type === "leave") {
        setDragging(false);
      } else {
        setDragging(false);
        const [path] = payload.paths;
        if (path) {
          setDocument(path);
          setView("print");
        }
      }
    });
    return () => {
      listening.then((unlisten) => unlisten());
    };
  }, []);

  // ⌘R reads the printer again, ⌘P opens printing, ⌘, opens Settings as in any macOS app; Esc leaves it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { view, setView, refresh } = useStore.getState();
      if (event.key === "r" && event.metaKey) {
        event.preventDefault();
        refresh();
      } else if (event.key === "p" && event.metaKey) {
        event.preventDefault();
        setView("print");
      } else if (event.key === "," && event.metaKey) {
        event.preventDefault();
        setView(view === "settings" ? "overview" : "settings");
      } else if (event.key === "Escape" && view === "settings") {
        setView("overview");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // The gutter around the panel doubles as a window drag handle.
    <div data-tauri-drag-region className="app-canvas flex h-screen py-2 pr-2">
      <Sidebar />
      <div key={view} className="flex min-w-0 flex-1 flex-col">
        {VIEWS[view]()}
      </div>
    </div>
  );
}

export default App;
