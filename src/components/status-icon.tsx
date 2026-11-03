import type { StatusTone } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Ring color per tone; solid tones also fill the center, like Linear's status icons. */
const TONE_CLASS: Record<StatusTone, string> = {
  ok: "border-success after:bg-success",
  done: "border-muted-foreground after:bg-muted-foreground",
  // A slowly turning dashed ring reads as "needs attention soon", like Linear's in-progress icon.
  pending: "border-warning border-dashed animate-spin-slow",
  failed: "border-destructive after:bg-destructive",
  unknown: "border-muted-foreground/60",
};

export function StatusIcon({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block size-3 shrink-0 rounded-full border-[1.5px] after:absolute after:inset-[2px] after:rounded-full",
        TONE_CLASS[tone],
        className,
      )}
    />
  );
}

/** Text color that goes with a tone, for labels next to the icon. */
export const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-foreground",
  done: "text-muted-foreground",
  pending: "text-warning",
  failed: "text-destructive",
  unknown: "text-muted-foreground",
};

/** Fill color for meters. */
export const TONE_FILL: Record<StatusTone, string> = {
  ok: "bg-success",
  done: "bg-muted-foreground",
  pending: "bg-warning",
  failed: "bg-destructive",
  unknown: "bg-muted-foreground/60",
};
