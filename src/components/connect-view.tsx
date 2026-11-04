import { Plug, Printer } from "lucide-react";
import { useState } from "react";

import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, errorMessage } from "@/lib/utils";
import { useStore } from "@/store";

/** The printer as a tile, lit in the accent color; the connecting card runs a light around it. */
export function PrinterTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-12 items-center justify-center rounded-[13px] bg-primary/15 text-primary",
        className,
      )}
    >
      <Printer className="size-6" />
    </div>
  );
}

/**
 * Asks for the printer's address before anything is read. Nothing is filled in
 * for the user: the app knows no printer until it is told one.
 */
export function ConnectView() {
  const settings = useStore((s) => s.settings);
  const lastHost = useStore((s) => s.lastHost);
  const connect = useStore((s) => s.connect);
  const [host, setHost] = useState(lastHost ?? "");
  const [community, setCommunity] = useState(settings?.community || "public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect(host.trim(), community.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <Plug className="size-4 text-muted-foreground" />
        <h1 className="font-medium">Kết nối máy in</h1>
      </PanelHeader>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
        <form
          onSubmit={submit}
          className="relative w-[360px] max-w-full animate-view-in overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_24px_64px_-12px_oklch(0_0_0/35%)]"
        >
          {/* A wash of the accent from the top edge, as on the connecting card. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40"
            style={{
              background:
                "radial-gradient(120% 100% at 50% 0%, color-mix(in oklch, var(--color-primary) 18%, transparent), transparent 70%)",
            }}
          />

          <div className="relative flex flex-col items-center px-6 pt-8 pb-5 text-center">
            <div className="relative">
              <div
                aria-hidden
                className="absolute inset-0 scale-125 rounded-2xl bg-primary opacity-25 blur-xl"
              />
              <div className="relative rounded-[18px] border border-border bg-popover p-[3px]">
                <PrinterTile />
              </div>
            </div>
            <h2 className="mt-5 text-[15px] font-medium tracking-tight">Kết nối máy in Ricoh</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Ricoh Hub chỉ đọc máy in ở địa chỉ bạn nhập, không đổi gì trên máy.
            </p>
          </div>

          <div className="relative flex flex-col gap-4 px-6 pb-6">
            <label className="flex flex-col gap-1.5 text-left">
              <span className="font-medium">Địa chỉ IP</span>
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
              <span className="text-xs text-muted-foreground">
                Xem trên máy in ở Settings › Network, hoặc in trang cấu hình.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-left">
              <span className="font-medium">SNMP community</span>
              <Input
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
              <span className="text-xs text-muted-foreground">
                Để public nếu chưa ai đổi trên máy in.
              </span>
            </label>
            {error && <p className="animate-fade-in text-xs text-destructive">{error}</p>}
          </div>

          <div className="relative flex h-12 items-center justify-end border-t border-border px-2">
            <Button type="submit" disabled={busy || !host.trim() || !community.trim()}>
              <Plug />
              {busy ? "Đang kết nối…" : "Kết nối"}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}
