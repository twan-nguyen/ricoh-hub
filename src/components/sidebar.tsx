import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ChartColumn,
  ChevronsUpDown,
  ExternalLink,
  FileUp,
  Hash,
  LayoutDashboard,
  ListOrdered,
  RotateCw,
  ScanLine,
  Settings,
} from "lucide-react";

import appIcon from "../../app-icon.svg";
import { StatusIcon } from "@/components/status-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { printerState } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

export function Sidebar() {
  const view = useStore((s) => s.view);
  const inSettings = view === "settings";

  return (
    <aside className="flex w-60 shrink-0 flex-col text-sidebar-foreground">
      {/* Leaves room for the macOS traffic lights and lets the window be dragged. */}
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div key={String(inSettings)} className="flex min-h-0 flex-1 animate-view-in flex-col">
        {inSettings ? <SettingsNav /> : <AppNav />}
      </div>
    </aside>
  );
}

function AppNav() {
  const { view, setView, snapshot } = useStore();

  return (
    <>
      <div className="flex items-center gap-1 px-3 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5">
          {/* The icon art leaves macOS grid padding, so it renders a bit larger. */}
          <img src={appIcon} alt="" className="-my-1.5 -ml-1 size-8 shrink-0" />
          {/* Wordmark: the app's own word stays bright, the shared brand recedes. */}
          <span className="truncate text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">
            Ricoh<span className="font-medium text-sidebar-accent-foreground/35">Hub</span>
          </span>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3">
        <Section title="Máy in">
          <NavItem
            icon={<LayoutDashboard />}
            label="Tổng quan"
            active={view === "overview"}
            onClick={() => setView("overview")}
          />
          <NavItem
            icon={<FileUp />}
            label="In tài liệu"
            active={view === "print"}
            onClick={() => setView("print")}
          />
          <NavItem
            icon={<ScanLine />}
            label="Scan"
            active={view === "scan"}
            onClick={() => setView("scan")}
          />
          <NavItem
            icon={<ListOrdered />}
            label="Lệnh in"
            count={snapshot?.jobs.length}
            active={view === "jobs"}
            onClick={() => setView("jobs")}
          />
          <NavItem
            icon={<Hash />}
            label="Bộ đếm"
            active={view === "counters"}
            onClick={() => setView("counters")}
          />
          <NavItem
            icon={<ChartColumn />}
            label="Thống kê"
            active={view === "stats"}
            onClick={() => setView("stats")}
          />
        </Section>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-2">
        <PrinterMenu />
      </div>
    </>
  );
}

/** Sits at the foot of the sidebar, where ClusterSmith keeps its cluster switcher. */
function PrinterMenu() {
  const { snapshot, settings, error, refresh, setView } = useStore();
  const host = snapshot?.host ?? settings?.host;
  const tone = error ? "failed" : snapshot ? printerState(snapshot.state).tone : "unknown";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={host ? `${snapshot?.model ?? "Máy in"} · ${host}` : undefined}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors duration-100 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
        >
          <StatusIcon tone={tone} />
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="truncate">{snapshot?.name ?? "Máy in"}</span>
            {host && <span className="truncate text-xs text-muted-foreground">{host}</span>}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel>{snapshot?.model ?? "Máy in"}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => refresh()}>
          <RotateCw />
          Đọc lại máy in
          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        {host && (
          <DropdownMenuItem onSelect={() => openUrl(`http://${host}/`)}>
            <ExternalLink />
            Mở Web Image Monitor
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setView("settings")}>
          <Settings />
          Cài đặt
          <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingsNav() {
  const setView = useStore((s) => s.setView);

  return (
    <>
      <div className="px-3 pb-3">
        <button
          onClick={() => setView("overview")}
          className="flex h-7 items-center gap-2 rounded-md px-2 text-muted-foreground transition-colors duration-100 hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-4"
        >
          <ArrowLeft />
          Quay lại
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3">
        <Section title="Cài đặt">
          <NavItem icon={<Settings />} label="Chung" active />
        </Section>
      </nav>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      <span className="flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** Shown at the end when above zero. */
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-100 hover:bg-sidebar-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count ? (
        <span className="animate-fade-in text-xs text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}
