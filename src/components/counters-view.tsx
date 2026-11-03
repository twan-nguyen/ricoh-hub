import { Hash, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { Panel, PanelHeader } from "@/components/panel";
import { RefreshStatus } from "@/components/refresh-status";
import { Empty, SnapshotGate } from "@/components/snapshot-gate";
import { formatNumber } from "@/lib/format";
import type { Counter } from "@/lib/printer";
import { useStore } from "@/store";

const COLUMNS: Column<Counter>[] = [
  {
    id: "index",
    label: "#",
    width: "40px",
    cell: (c) => <span className="text-muted-foreground tabular-nums">{c.index}</span>,
  },
  {
    id: "name",
    label: "Tên bộ đếm (theo máy in)",
    width: "minmax(220px,1fr)",
    cell: (c) => (
      <span className="truncate select-text" title={c.name}>
        {c.name}
      </span>
    ),
  },
  {
    id: "value",
    label: "Giá trị",
    width: "120px",
    align: "right",
    cell: (c) => <span className="tabular-nums select-text">{formatNumber(c.value)}</span>,
  },
];

/** Every counter in Ricoh's table, as the printer names them. */
export function CountersView() {
  const counters = useStore((s) => s.snapshot?.counters);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!counters || !needle) return counters ?? [];
    return counters.filter((c) => c.name.toLowerCase().includes(needle));
  }, [counters, query]);

  return (
    <Panel>
      <PanelHeader>
        <Hash className="size-4 text-muted-foreground" />
        <h1 className="font-medium">Bộ đếm</h1>
        <span className="text-muted-foreground tabular-nums">{counters ? visible.length : ""}</span>
        <label className="ml-4 flex h-7 w-60 min-w-28 shrink items-center gap-2 rounded-md px-2 text-muted-foreground transition-colors duration-100 hover:bg-accent focus-within:bg-accent">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Lọc theo tên, ví dụ Copy"
            aria-label="Lọc bộ đếm theo tên"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <RefreshStatus />
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <SnapshotGate>
          {() =>
            visible.length === 0 ? (
              <Empty title="Không có bộ đếm nào khớp" detail={`Không tên nào chứa “${query}”.`} />
            ) : (
              <DataTable columns={COLUMNS} rows={visible} rowKey={(c) => c.index} />
            )
          }
        </SnapshotGate>
      </div>
    </Panel>
  );
}
