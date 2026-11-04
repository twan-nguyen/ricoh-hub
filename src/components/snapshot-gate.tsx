import type { Snapshot } from "@/lib/printer";
import { useStore } from "@/store";

/**
 * Shows a view once the first snapshot has arrived. Until then, placeholder
 * blocks sit under the connecting card, which also says why a printer cannot be reached.
 */
export function SnapshotGate({ children }: { children: (snapshot: Snapshot) => React.ReactNode }) {
  const snapshot = useStore((s) => s.snapshot);
  return snapshot ? children(snapshot) : <SkeletonBlocks />;
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
