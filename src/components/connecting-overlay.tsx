import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { PrinterTile } from "@/components/connect-view";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

/** After this long, a hint about the usual cause (Energy Saver) appears. */
const SLOW_AFTER_S = 5;

const ACCENT = "oklch(0.72 0.14 276)";

/**
 * Covers the app from giving an address until the printer first answers, with
 * a way out. When it cannot be reached, the same card offers a retry. The Rust
 * side keeps trying on its timer, so the card also closes on its own once the
 * printer wakes.
 */
export function ConnectingOverlay() {
  const host = useStore((s) => s.settings?.host);
  const snapshot = useStore((s) => s.snapshot);
  const failure = useStore((s) => s.error);
  const loading = useStore((s) => s.loading);
  const refresh = useStore((s) => s.refresh);
  const disconnect = useStore((s) => s.disconnect);
  const [seconds, setSeconds] = useState(0);
  // A retry shows the connecting card again until that read ends. Reads the
  // Rust side makes on its own leave the failure card standing.
  const [retrying, setRetrying] = useState(false);
  const open = !!host && !snapshot;
  const failed = failure !== null && !retrying;
  const connecting = open && !failed;

  useEffect(() => {
    if (!loading) setRetrying(false);
  }, [loading]);

  useEffect(() => {
    if (!connecting) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connecting, host]);

  // Esc backs out to the address form. Enter retries through the focused button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && disconnect();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, disconnect]);

  if (!open) return null;
  const accent = failed ? "var(--color-destructive)" : ACCENT;
  const slow = seconds >= SLOW_AFTER_S;

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/45 backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-modal
        aria-label={failed ? "Không kết nối được máy in" : "Đang kết nối máy in"}
        className="relative w-[340px] animate-view-in overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_24px_64px_-12px_oklch(0_0_0/60%)]"
      >
        {/* A wash of the accent from the top edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40"
          style={{
            background:
              failed
                ? "radial-gradient(120% 100% at 50% 0%, color-mix(in oklch, var(--color-destructive) 16%, transparent), transparent 70%)"
                : "radial-gradient(120% 100% at 50% 0%, color-mix(in oklch, var(--color-primary) 18%, transparent), transparent 70%)",
          }}
        />

        <div className="relative flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 scale-125 rounded-2xl opacity-40 blur-xl"
              style={{ background: accent }}
            />
            {/* A light running around the tile's edge; a still red one on failure. */}
            <div
              className={cn(
                "relative rounded-[18px] p-[2px]",
                !failed && "animate-orbit motion-reduce:animate-none",
              )}
              style={{
                background:
                  failed
                    ? accent
                    : `conic-gradient(from var(--orbit-angle), transparent 0deg 200deg, ${accent} 360deg)`,
              }}
            >
              <div className="rounded-2xl bg-popover p-[3px]">
                <PrinterTile />
              </div>
            </div>
            {failed && (
              <span className="absolute -right-2 -bottom-2 flex size-6 animate-fade-in items-center justify-center rounded-full border-2 border-popover bg-destructive text-white">
                <TriangleAlert className="size-3" />
              </span>
            )}
          </div>

          <h2 className="mt-5 text-[15px] font-medium tracking-tight">
            {failed ? "Không kết nối được máy in" : "Đang kết nối máy in"}
          </h2>
          <p
            className="mt-1.5 max-w-full truncate rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground"
            title={host}
          >
            {host}
          </p>
          {failed && (
            <p
              className="mt-4 line-clamp-3 animate-fade-in text-xs break-words text-muted-foreground"
              title={failure}
            >
              {failure}
            </p>
          )}
        </div>

        {failed ? (
          <div className="flex items-center gap-2 border-t border-border py-2 pr-2 pl-4">
            <span className="flex-1 truncate text-xs text-muted-foreground">
              Máy in đã bật?
            </span>
            <Button variant="ghost" size="sm" onClick={disconnect}>
              Đổi địa chỉ
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setRetrying(true);
                refresh();
              }}
              autoFocus
              className="gap-1.5"
            >
              <RotateCw />
              Thử lại
            </Button>
          </div>
        ) : (
          <>
            {/* An indeterminate bar doubles as the divider above the footer. */}
            <div aria-hidden className="relative h-px overflow-hidden bg-border">
              <div
                className="absolute inset-y-0 w-1/3 animate-indeterminate motion-reduce:hidden"
                style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
              />
            </div>
            <div className="flex h-11 items-center gap-3 pr-2 pl-4">
              <span
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 text-xs",
                  slow ? "text-warning" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none",
                    slow ? "bg-warning" : "bg-muted-foreground/70",
                  )}
                />
                <span key={slow ? "slow" : "loading"} className="animate-fade-in truncate">
                  {slow ? "Chưa trả lời. Máy in đang ngủ?" : "Đang đọc máy in…"}
                </span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                  {seconds}s
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={disconnect} className="gap-1.5">
                Huỷ
                <Kbd>Esc</Kbd>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
