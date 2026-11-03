import { RotateCw, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Snapshot } from "@/lib/printer";
import { useStore } from "@/store";

/**
 * Shows a view once the first snapshot has arrived. Until then: placeholder
 * blocks while loading, or why the printer could not be reached.
 */
export function SnapshotGate({ children }: { children: (snapshot: Snapshot) => React.ReactNode }) {
  const { snapshot, error, loading, settings, refresh, setView } = useStore();

  if (snapshot) return children(snapshot);
  if (error && !loading) {
    return (
      <Empty
        title={`Không kết nối được máy in${settings ? ` tại ${settings.host}` : ""}`}
        detail={`Kiểm tra máy in đã bật và máy tính đang cùng mạng với máy in. Chi tiết: ${error}`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={refresh}>
              <RotateCw />
              Thử lại
            </Button>
            <Button variant="ghost" onClick={() => setView("settings")}>
              <Settings />
              Đổi địa chỉ máy in
            </Button>
          </div>
        }
      />
    );
  }
  return <SkeletonBlocks />;
}

export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center gap-1 px-8 py-24 text-center">
      <div className="font-medium">{title}</div>
      {detail && <div className="max-w-md break-words text-muted-foreground">{detail}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Placeholder shapes while the printer answers; waking from Energy Saver takes a moment. */
function SkeletonBlocks() {
  return (
    <div role="status" aria-label="Đang đọc máy in" className="flex animate-fade-in flex-col gap-6 p-6">
      {[40, 96, 128].map((height, i) => (
        <div key={i} className="flex flex-col gap-2">
          <span className="h-3 w-24 animate-pulse rounded bg-muted-foreground/15" />
          <span
            className="animate-pulse rounded-lg bg-muted-foreground/10"
            style={{ height }}
          />
        </div>
      ))}
    </div>
  );
}
