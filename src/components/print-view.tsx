import { open } from "@tauri-apps/plugin-dialog";
import { CircleCheck, FileText, FileUp, Minus, Plus, Printer, X } from "lucide-react";
import { useState } from "react";

import { Field, Segmented } from "@/components/form-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type StatusTone, paperLeft, paperSize, trayName, trayStatus } from "@/lib/format";
import {
  PRINTABLE_EXTENSIONS,
  type PrintOptions,
  type Sides,
  type SubmittedJob,
  type Tray,
  type TraySource,
} from "@/lib/printer";
import { cn, errorMessage } from "@/lib/utils";
import { useStore } from "@/store";

const SIDES: { value: Sides; label: string }[] = [
  { value: "one-sided", label: "1 mặt" },
  { value: "two-sided-long-edge", label: "2 mặt, lật cạnh dài" },
  { value: "two-sided-short-edge", label: "2 mặt, lật cạnh ngắn" },
];

const DEFAULT_OPTIONS: PrintOptions = { copies: 1, sides: "one-sided", tray: "auto", pages: "" };

/** Which IPP media-source feeds from a tray the printer listed. */
function traySource(tray: Tray): TraySource | null {
  if (tray.manual) return "manual";
  const number = tray.name.match(/(\d+)$/)?.[1];
  return number === "1" ? "tray-1" : number === "2" ? "tray-2" : null;
}

const fileName = (path: string) => path.split("/").pop() ?? path;
const folder = (path: string) => path.split("/").slice(0, -1).join("/");
const isPrintable = (path: string) =>
  PRINTABLE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");

export function PrintView() {
  // Shown at the top: once sent, the file leaves and the picker takes its place.
  const [sent, setSent] = useState<SubmittedJob | null>(null);
  const setView = useStore((s) => s.setView);

  return (
    <Panel>
      <PanelHeader>
        <FileUp className="size-4 text-muted-foreground" />
        <h1 className="font-medium">In tài liệu</h1>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="mx-auto flex max-w-2xl animate-view-in flex-col gap-6 px-8 py-8">
          {sent && (
            <div className="flex animate-fade-in items-center gap-2 rounded-lg border border-success/30 bg-success/8 py-2 pr-2 pl-4 text-success">
              <CircleCheck className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Đã gửi “{sent.name}” tới máy in (lệnh #{sent.id}).
              </span>
              <Button variant="ghost" size="sm" onClick={() => setView("jobs")}>
                Xem lệnh in
              </Button>
            </div>
          )}
          <DocumentPicker />
          <PrintForm onSent={setSent} />
        </section>
      </div>
    </Panel>
  );
}

function DocumentPicker() {
  const { document, dragging, setDocument } = useStore();

  async function pick() {
    const path = await open({
      multiple: false,
      directory: false,
      title: "Chọn file để in",
      filters: [{ name: "PDF, JPEG, PostScript", extensions: PRINTABLE_EXTENSIONS }],
    });
    if (path) setDocument(path);
  }

  if (!document) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-dashed border-foreground/20 px-6 py-10 text-center transition-colors duration-150",
          dragging && "border-primary bg-primary/8",
        )}
      >
        <FileUp className={cn("size-6 text-muted-foreground", dragging && "text-primary")} />
        <div className="flex flex-col gap-1">
          <span className="font-medium">{dragging ? "Thả file để in" : "Kéo file PDF hoặc JPEG vào cửa sổ"}</span>
          <span className="text-muted-foreground">Máy in nhận PDF, JPEG và PostScript.</span>
        </div>
        <Button variant="outline" onClick={pick}>
          Chọn file…
        </Button>
      </div>
    );
  }

  const printable = isPrintable(document);
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors duration-150",
          dragging && "border-primary bg-primary/8",
        )}
      >
        <FileText className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium" title={document}>
            {fileName(document)}
          </span>
          <span className="truncate text-xs text-muted-foreground">{folder(document)}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={pick}>
          Đổi file
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Bỏ file này"
          title="Bỏ file này"
          onClick={() => setDocument(null)}
        >
          <X />
        </Button>
      </div>
      {!printable && (
        <p className="animate-fade-in text-destructive">
          Máy in chỉ nhận file PDF, JPEG hoặc PostScript. Hãy xuất file này sang PDF rồi in.
        </p>
      )}
    </div>
  );
}

function PrintForm({ onSent }: { onSent: (job: SubmittedJob | null) => void }) {
  const { document, snapshot, print } = useStore();
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<PrintOptions>) => {
    setOptions((o) => ({ ...o, ...patch }));
    setError(null);
  };

  const trays = (snapshot?.trays ?? []).flatMap((tray) => {
    const source = traySource(tray);
    return source ? [{ tray, source }] : [];
  });
  const chosenTray = trays.find((t) => t.source === options.tray)?.tray;
  const canPrint = Boolean(document && isPrintable(document)) && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    onSent(null);
    try {
      onSent(await print(options));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-lg border border-border p-5">
      <Field label="Số bản" htmlFor="copies">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Bớt một bản"
            disabled={options.copies <= 1}
            onClick={() => update({ copies: options.copies - 1 })}
          >
            <Minus />
          </Button>
          <Input
            id="copies"
            inputMode="numeric"
            value={options.copies}
            onChange={(e) => {
              const copies = Number(e.target.value.replace(/\D/g, ""));
              update({ copies: Math.min(255, Math.max(1, copies || 1)) });
            }}
            className="w-16 text-center tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Thêm một bản"
            disabled={options.copies >= 255}
            onClick={() => update({ copies: options.copies + 1 })}
          >
            <Plus />
          </Button>
        </div>
      </Field>

      <Field label="Mặt in" hint="Tài liệu dọc thông thường thì chọn lật cạnh dài.">
        <Segmented
          label="Mặt in"
          value={options.sides}
          options={SIDES}
          onChange={(sides) => update({ sides })}
        />
      </Field>

      <Field label="Khay giấy" hint={<TrayHint source={options.tray} tray={chosenTray} />}>
        <Segmented
          label="Khay giấy"
          value={options.tray}
          options={[
            { value: "auto", label: "Tự động" },
            ...trays.map(({ tray, source }) => ({
              value: source,
              label: `${trayName(tray)} · ${paperSize(tray)}`,
            })),
          ]}
          onChange={(tray) => update({ tray })}
        />
      </Field>

      <Field label="Trang" htmlFor="pages" hint="Ví dụ 1-3, 5. Để trống để in tất cả.">
        <Input
          id="pages"
          value={options.pages}
          onChange={(e) => update({ pages: e.target.value })}
          placeholder="Tất cả các trang"
          spellCheck={false}
          autoComplete="off"
          className="w-60"
        />
      </Field>

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={!canPrint}>
          <Printer />
          {busy ? "Đang gửi tới máy in…" : "In"}
        </Button>
        {!document && <span className="text-muted-foreground">Chọn một file để in.</span>}
      </div>

      {error && <p className="animate-fade-in break-words text-destructive">{error}</p>}
    </form>
  );
}

const HINT_TONE: Partial<Record<StatusTone, string>> = {
  pending: "text-warning",
  failed: "text-destructive",
};

/** What to know about the chosen tray before sending the job. */
function TrayHint({ source, tray }: { source: TraySource; tray: Tray | undefined }) {
  if (source === "auto" || !tray) return "Máy tự chọn khay có khổ giấy hợp với tài liệu.";
  const status = trayStatus(tray);
  if (tray.manual) {
    return tray.level === 0 || !tray.available
      ? "Đặt giấy vào khay tay trước khi bấm In."
      : "Khay tay đang có giấy.";
  }
  const share = paperLeft(tray);
  const left = share ? `, còn khoảng ${share}` : "";
  return (
    <span className={HINT_TONE[status.tone]}>
      {trayName(tray)}: {status.label.toLowerCase()}
      {left}.
    </span>
  );
}
