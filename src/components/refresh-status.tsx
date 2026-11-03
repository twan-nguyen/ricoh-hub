import { RotateCw } from "lucide-react";

import { formatAgo, useNow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

/** Right end of a panel header: how fresh the numbers are, and a way to read again. */
export function RefreshStatus() {
  const { updatedAt, error, loading, snapshot, refresh } = useStore();
  const now = useNow();

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {error && snapshot && (
        <span
          title={error}
          className="flex h-6 animate-fade-in items-center gap-1.5 rounded-md px-2 text-xs text-warning"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-warning motion-reduce:animate-none" />
          Đang kết nối lại…
        </span>
      )}
      {updatedAt && (
        <span className="text-xs text-muted-foreground tabular-nums">
          Cập nhật {formatAgo(updatedAt, now)}
        </span>
      )}
      <button
        onClick={refresh}
        disabled={loading}
        aria-label="Đọc lại máy in (⌘R)"
        title="Đọc lại máy in (⌘R)"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground disabled:pointer-events-none [&_svg]:size-4"
      >
        <RotateCw className={cn(loading && "animate-spin motion-reduce:animate-none")} />
      </button>
    </div>
  );
}
