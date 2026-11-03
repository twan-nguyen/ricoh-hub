import { cn } from "@/lib/utils";

export type Column<T> = {
  id: string;
  label: string;
  /** A CSS grid track, such as `minmax(120px,1fr)` or `64px`. */
  width: string;
  /** Numbers line up on the right. */
  align?: "right";
  cell: (row: T) => React.ReactNode;
};

/** A plain table in the panel body, styled like ClusterSmith's lists. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
}) {
  const grid = { gridTemplateColumns: columns.map((c) => c.width).join(" ") };

  return (
    <div role="table" className="animate-fade-in">
      <div
        role="row"
        className="sticky top-0 z-10 grid h-8 items-center gap-4 border-b border-border bg-card px-5 text-xs text-muted-foreground"
        style={grid}
      >
        {columns.map((c) => (
          <span
            key={c.id}
            role="columnheader"
            className={cn("truncate", c.align === "right" && "text-right")}
          >
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          role="row"
          className="grid h-9 items-center gap-4 border-b border-border/50 px-5 transition-colors duration-100 hover:bg-accent"
          style={grid}
        >
          {columns.map((c) => (
            <span
              key={c.id}
              role="cell"
              className={cn("flex min-w-0 items-center", c.align === "right" && "justify-end")}
            >
              {c.cell(row)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
