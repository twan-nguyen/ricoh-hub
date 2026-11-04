import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, FileText, FolderOpen, Inbox, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { formatBucketDate } from "@/lib/format";
import {
  type StoredFile,
  type StoredFiles,
  downloadStoredFile,
  getStoredThumbnail,
  listStoredFiles,
  openScan,
  revealScan,
} from "@/lib/printer";
import { cn, errorMessage } from "@/lib/utils";
import { useStore } from "@/store";

/** Each read walks two slow Web Image Monitor pages, so the list is read only now and then while open. */
const POLL_MS = 30_000;

/** The last list read, shown at once when the view opens again while a fresh one is read. */
let lastList: { host: string; list: StoredFiles } | null = null;

/**
 * Thumbnails by file, as object URLs. The printer serves each thumbnail address once
 * and gives a new one with every list, so a picture is fetched once per file and kept.
 */
const thumbnails = new Map<string, Promise<string | null>>();

function thumbnail(file: StoredFile): Promise<string | null> {
  let url = thumbnails.get(file.docId);
  if (!url && file.thumbnailId) {
    url = getStoredThumbnail(file.thumbnailId).then(
      (bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })),
      () => {
        // A later list brings a fresh address to try again with.
        thumbnails.delete(file.docId);
        return null;
      },
    );
    thumbnails.set(file.docId, url);
  }
  return url ?? Promise.resolve(null);
}

/** Lets go of pictures for files the printer no longer holds. */
function forgetThumbnails(kept: StoredFile[]) {
  const ids = new Set(kept.map((f) => f.docId));
  for (const [docId, url] of thumbnails) {
    if (ids.has(docId)) continue;
    thumbnails.delete(docId);
    url.then((u) => u && URL.revokeObjectURL(u));
  }
}

const FUNCTIONS: Record<string, string> = { Scanner: "Scan", Copier: "Copy", Printer: "In" };
const COLORS: Record<string, string> = {
  "Full Color": "Màu",
  "Black & White": "Đen trắng",
  "Gray Scale": "Xám",
};

/**
 * Scans started on the printer's panel and stored in its Document Server, with a
 * way to save each one into the scan folder. The printer keeps its copy.
 */
export function StoredFilesView() {
  const host = useStore((s) => s.settings?.host);
  const [list, setList] = useState<StoredFiles | null>(() =>
    lastList && lastList.host === host ? lastList.list : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function read() {
    setLoading(true);
    const from = host;
    listStoredFiles()
      .then((next) => {
        if (from) lastList = { host: from, list: next };
        forgetThumbnails(next.files);
        setList(next);
        setError(null);
      }, (err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const same = lastList?.host === host;
    // Another printer numbers its files on its own, so its pictures start afresh.
    if (!same) forgetThumbnails([]);
    setList(same && lastList ? lastList.list : null);
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [host]);

  const hidden = list ? list.total - list.files.length : 0;

  return (
    <Panel>
      <PanelHeader>
        <Inbox className="size-4 text-muted-foreground" />
        <h1 className="font-medium">File trên máy in</h1>
        {list && <span className="text-muted-foreground tabular-nums">{list.total}</span>}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={read} disabled={loading} aria-label="Đọc lại danh sách">
            <RotateCw className={cn(loading && "animate-spin motion-reduce:animate-none")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => host && openUrl(`http://${host}/web/guest/en/websys/webArch/mainFrame.cgi`)}
          >
            <ExternalLink />
            Mở trên web
          </Button>
        </span>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="mx-auto flex max-w-2xl animate-view-in flex-col gap-4 px-8 py-8">
          <p className="text-muted-foreground">
            Bản scan bấm trên máy in và lưu vào Document Server, thư mục Shared Folder. Tải về thì
            file được lưu dạng PDF vào thư mục scan, bản trên máy in vẫn giữ nguyên. Máy tự xoá file
            sau vài ngày.
          </p>

          {error ? (
            <p className="animate-fade-in break-words text-destructive">{error}</p>
          ) : !list ? (
            <span role="status" aria-label="Đang đọc danh sách" className="h-32 animate-pulse rounded-lg bg-muted-foreground/10" />
          ) : list.files.length === 0 ? (
            <p className="animate-fade-in rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
              Chưa có file nào. Khi scan trên máy in, chọn lưu file (Store File) để bản scan nằm ở đây.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {list.files.map((file) => (
                <StoredRow key={file.docId} file={file} />
              ))}
            </div>
          )}
          {hidden > 0 && (
            <p className="text-xs text-muted-foreground">Còn {hidden} file cũ hơn, xem trên web.</p>
          )}
        </section>
      </div>
    </Panel>
  );
}

function StoredRow({ file }: { file: StoredFile }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      setSaved((await downloadStoredFile(file.docId)).path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const run = (action: Promise<void>) => action.catch((err) => setError(errorMessage(err)));

  const details = [
    // The printer's own clock, given without a zone: shown as written, "04/11 12:31".
    file.created && `${formatBucketDate(file.created.slice(0, 10))} ${file.created.slice(11, 16)}`,
    file.pages !== null && `${file.pages} trang`,
    file.function && FUNCTIONS[file.function] !== "Scan" && (FUNCTIONS[file.function] ?? file.function),
    file.color && (COLORS[file.color] ?? file.color),
  ].filter(Boolean);

  return (
    <div className="flex animate-fade-in items-center gap-3 py-2 pr-2 pl-2">
      <Thumbnail file={file} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={file.name}>
          {file.name}
        </span>
        {error ? (
          <span className="animate-fade-in truncate text-xs text-destructive" title={error}>
            {error}
          </span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">{details.join(" · ")}</span>
        )}
      </div>
      {saved ? (
        <span className="flex shrink-0 animate-fade-in items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => run(openScan(saved))}>
            <ExternalLink />
            Mở
          </Button>
          <Button variant="ghost" size="sm" onClick={() => run(revealScan(saved))}>
            <FolderOpen />
            Hiện trong Finder
          </Button>
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={download} disabled={busy} className="shrink-0">
          <Download className={cn(busy && "animate-pulse motion-reduce:animate-none")} />
          {busy ? "Đang tải…" : "Tải về"}
        </Button>
      )}
    </div>
  );
}

/** The printer's own preview of the first page; a file icon until it arrives, or if it cannot. */
function Thumbnail({ file }: { file: StoredFile }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    thumbnail(file).then((next) => live && setUrl(next));
    return () => {
      live = false;
    };
  }, [file.docId, file.thumbnailId]);

  return (
    <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <FileText className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}
