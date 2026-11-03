import { CircleCheck, ExternalLink, FileText, FolderOpen, ScanLine, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { Field, Segmented } from "@/components/form-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { Empty } from "@/components/snapshot-gate";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import {
  type ColorMode,
  type ScanFormat,
  type ScanOptions,
  type ScanSource,
  type ScannerCapabilities,
  type ScannerStatus,
  getScanFolder,
  getScanner,
  getScannerStatus,
  openScan,
  revealScan,
} from "@/lib/printer";
import { errorMessage } from "@/lib/utils";
import { useStore } from "@/store";

/** How often the feeder is checked while this view is open, so "paper loaded" shows up quickly. */
const STATUS_POLL_MS = 3000;
const OPTIONS_KEY = "ricoh-hub:scan-options";

const PAPER: { label: string; widthMm: number; heightMm: number }[] = [
  { label: "A4", widthMm: 210, heightMm: 297 },
  { label: "A3", widthMm: 297, heightMm: 420 },
  { label: "Letter", widthMm: 216, heightMm: 279 },
];

const COLORS: { value: ColorMode; label: string }[] = [
  { value: "BlackAndWhite1", label: "Đen trắng" },
  { value: "Grayscale8", label: "Xám" },
  { value: "RGB24", label: "Màu" },
];

const DEFAULT_OPTIONS: ScanOptions = {
  source: "Platen",
  duplex: false,
  colorMode: "Grayscale8",
  resolution: 300,
  widthMm: 210,
  heightMm: 297,
  format: "application/pdf",
};

/** The last choices, so a daily scan needs no clicks; storage may be unavailable. */
function loadOptions(): ScanOptions {
  try {
    const saved = localStorage.getItem(OPTIONS_KEY);
    return saved ? { ...DEFAULT_OPTIONS, ...JSON.parse(saved) } : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(options: ScanOptions) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Remembering is a convenience; scanning works without it.
  }
}

const fileName = (path: string) => path.split("/").pop() ?? path;

export function ScanView() {
  const [caps, setCaps] = useState<ScannerCapabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const host = useStore((s) => s.settings?.host);
  const chosenFolder = useStore((s) => s.settings?.scanFolder);

  useEffect(() => {
    setCaps(null);
    setCapsError(null);
    getScanner().then(setCaps, (err) => setCapsError(errorMessage(err)));
  }, [host]);

  useEffect(() => {
    getScanFolder().then(setFolder, () => setFolder(null));
  }, [chosenFolder]);

  useEffect(() => {
    const read = () => getScannerStatus().then(setStatus, () => setStatus(null));
    read();
    const timer = setInterval(read, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [host]);

  return (
    <Panel>
      <PanelHeader>
        <ScanLine className="size-4 text-muted-foreground" />
        <h1 className="font-medium">Scan</h1>
        {status && <ScannerState status={status} />}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {capsError ? (
          <Empty
            title="Không đọc được máy scan"
            detail={`Kiểm tra máy in đã bật và cùng mạng. Chi tiết: ${capsError}`}
          />
        ) : !caps ? (
          <div role="status" aria-label="Đang đọc máy scan" className="mx-auto flex max-w-2xl flex-col gap-4 px-8 py-8">
            <span className="h-48 animate-pulse rounded-lg bg-muted-foreground/10" />
          </div>
        ) : (
          <section className="mx-auto flex max-w-2xl animate-view-in flex-col gap-6 px-8 py-8">
            <ScanResult />
            <ScanForm caps={caps} status={status} folder={folder} />
          </section>
        )}
      </div>
    </Panel>
  );
}

function ScannerState({ status }: { status: ScannerStatus }) {
  const busy = status.state === "Processing";
  return (
    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusIcon tone={busy ? "pending" : status.state === "Idle" ? "ok" : "unknown"} />
      {busy ? "Máy scan đang chạy" : status.state === "Idle" ? "Máy scan sẵn sàng" : status.state}
    </span>
  );
}

/** What the last scan saved, with ways to open it; or why it stopped. */
function ScanResult() {
  const { scanning, scanFiles, scanError } = useStore();
  const [actionError, setActionError] = useState<string | null>(null);
  const run = (action: Promise<void>) => action.catch((err) => setActionError(errorMessage(err)));

  if (!scanning && scanFiles.length === 0 && !scanError) return null;
  const cancelled = scanError === "Đã hủy scan.";

  return (
    <div className="flex flex-col gap-2">
      {scanning ? (
        <div className="flex animate-fade-in items-center gap-2 text-muted-foreground">
          <StatusIcon tone="pending" />
          {scanFiles.length === 0
            ? "Đang scan…"
            : `Đang scan… đã nhận ${scanFiles.length} file`}
        </div>
      ) : scanError ? (
        <p className={cancelled ? "text-muted-foreground" : "break-words text-destructive"}>{scanError}</p>
      ) : (
        <div className="flex animate-fade-in items-center gap-2 text-success">
          <CircleCheck className="size-4 shrink-0" />
          Đã lưu {scanFiles.length === 1 ? "file scan" : `${scanFiles.length} file scan`}.
        </div>
      )}
      {scanFiles.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {scanFiles.map((file) => (
            <div key={file.path} className="flex animate-fade-in items-center gap-3 py-2 pr-2 pl-4">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={file.path}>
                {fileName(file.path)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(file.bytes)}</span>
              <Button variant="ghost" size="sm" onClick={() => run(openScan(file.path))}>
                <ExternalLink />
                Mở
              </Button>
              <Button variant="ghost" size="sm" onClick={() => run(revealScan(file.path))}>
                <FolderOpen />
                Hiện trong Finder
              </Button>
            </div>
          ))}
        </div>
      )}
      {actionError && <p className="animate-fade-in text-destructive">{actionError}</p>}
    </div>
  );
}

function ScanForm({
  caps,
  status,
  folder,
}: {
  caps: ScannerCapabilities;
  status: ScannerStatus | null;
  folder: string | null;
}) {
  const { scanning, scan, cancelScan, setView } = useStore();
  const [options, setOptions] = useState(loadOptions);
  const update = (patch: Partial<ScanOptions>) =>
    setOptions((o) => {
      const next = { ...o, ...patch };
      // Two-sided only exists on the feeder; black-and-white JPEG is not a thing.
      if (next.source === "Platen") next.duplex = false;
      if (next.format === "image/jpeg" && next.colorMode === "BlackAndWhite1") next.colorMode = "Grayscale8";
      saveOptions(next);
      return next;
    });

  const feederReady = status?.adfState === "ScannerAdfLoaded";
  const paper = PAPER.filter((p) => p.widthMm <= caps.maxWidthMm && p.heightMm <= caps.maxHeightMm);
  const resolutions = [200, 300, 600].filter((r) => caps.resolutions.includes(r));
  const blocked = options.source === "Feeder" && status !== null && !feederReady;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        scan(options);
      }}
      className="flex flex-col gap-5 rounded-lg border border-border p-5"
    >
      <Field label="Nguồn" hint={<SourceHint source={options.source} status={status} />}>
        <Segmented<ScanSource>
          label="Nguồn"
          value={options.source}
          options={[
            { value: "Platen", label: "Mặt kính" },
            { value: "Feeder", label: "Khay nạp bản gốc", disabled: !caps.hasFeeder },
          ]}
          onChange={(source) => update({ source })}
        />
      </Field>

      {options.source === "Feeder" && caps.feederDuplex && (
        <Field label="Mặt">
          <Segmented
            label="Mặt"
            value={options.duplex ? "duplex" : "simplex"}
            options={[
              { value: "simplex", label: "1 mặt" },
              { value: "duplex", label: "2 mặt" },
            ]}
            onChange={(v) => update({ duplex: v === "duplex" })}
          />
        </Field>
      )}

      <Field label="Màu">
        <Segmented<ColorMode>
          label="Màu"
          value={options.colorMode}
          options={COLORS.filter((c) => caps.colorModes.includes(c.value)).map((c) => ({
            ...c,
            disabled: c.value === "BlackAndWhite1" && options.format === "image/jpeg",
          }))}
          onChange={(colorMode) => update({ colorMode })}
        />
      </Field>

      <Field label="Độ phân giải" hint="300 dpi đủ cho giấy tờ. 600 dpi cho ảnh hoặc chữ rất nhỏ, file nặng hơn nhiều.">
        <Segmented
          label="Độ phân giải"
          value={String(options.resolution)}
          options={resolutions.map((r) => ({ value: String(r), label: `${r} dpi` }))}
          onChange={(r) => update({ resolution: Number(r) })}
        />
      </Field>

      <Field label="Khổ bản gốc">
        <Segmented
          label="Khổ bản gốc"
          value={paper.find((p) => p.widthMm === options.widthMm && p.heightMm === options.heightMm)?.label ?? "A4"}
          options={paper.map((p) => ({ value: p.label, label: p.label }))}
          onChange={(label) => {
            const p = paper.find((x) => x.label === label);
            if (p) update({ widthMm: p.widthMm, heightMm: p.heightMm });
          }}
        />
      </Field>

      <Field
        label="Định dạng"
        hint={options.format === "image/jpeg" ? "Mỗi trang một file JPEG." : "Một file PDF, mở được ở mọi máy."}
      >
        <Segmented<ScanFormat>
          label="Định dạng"
          value={options.format}
          options={[
            { value: "application/pdf", label: "PDF" },
            { value: "image/jpeg", label: "JPEG", disabled: !caps.formats.includes("image/jpeg") },
          ]}
          onChange={(format) => update({ format })}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        {scanning ? (
          <Button type="button" variant="outline" onClick={() => cancelScan()}>
            <Square />
            Dừng scan
          </Button>
        ) : (
          <Button type="submit" disabled={blocked}>
            <ScanLine />
            Scan
          </Button>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={folder ?? undefined}>
          Lưu vào {folder ? folder.replace(/^\/Users\/[^/]+/, "~") : "Downloads/Ricoh Scans"} ·{" "}
          <button
            type="button"
            onClick={() => setView("settings")}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Đổi
          </button>
        </span>
      </div>
    </form>
  );
}

function SourceHint({ source, status }: { source: ScanSource; status: ScannerStatus | null }) {
  if (source === "Platen") return "Úp bản gốc xuống mặt kính, căn vào góc trên bên trái.";
  switch (status?.adfState) {
    case "ScannerAdfLoaded":
      return <span className="text-success">Đã có giấy trong khay nạp.</span>;
    case "ScannerAdfJam":
      return <span className="text-destructive">Bản gốc bị kẹt trong khay nạp.</span>;
    case undefined:
    case null:
      return "Đặt bản gốc ngửa lên, đầu trang vào trước.";
    default:
      return <span className="text-warning">Chưa có giấy trong khay nạp. Đặt bản gốc ngửa lên.</span>;
  }
}
