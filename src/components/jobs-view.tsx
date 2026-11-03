import { ListOrdered } from "lucide-react";

import { type Column, DataTable } from "@/components/data-table";
import { Panel, PanelHeader } from "@/components/panel";
import { RefreshStatus } from "@/components/refresh-status";
import { Empty, SnapshotGate } from "@/components/snapshot-gate";
import { StatusIcon } from "@/components/status-icon";
import { formatDateTime, formatNumber, jobState } from "@/lib/format";
import type { Job } from "@/lib/printer";
import { useStore } from "@/store";

const COLUMNS: Column<Job>[] = [
  {
    id: "id",
    label: "Mã",
    width: "56px",
    cell: (j) => <span className="text-muted-foreground tabular-nums">{j.id}</span>,
  },
  {
    id: "name",
    label: "Tài liệu",
    width: "minmax(200px,2fr)",
    cell: (j) => (
      <span className="truncate" title={j.name ?? undefined}>
        {j.name ?? "Không tên"}
      </span>
    ),
  },
  {
    id: "user",
    label: "Người gửi",
    width: "minmax(100px,1fr)",
    cell: (j) => <span className="truncate text-muted-foreground">{j.user ?? "—"}</span>,
  },
  {
    id: "state",
    label: "Trạng thái",
    width: "120px",
    cell: (j) => {
      const state = jobState(j.state);
      return (
        <span className="flex min-w-0 items-center gap-2">
          <StatusIcon tone={state.tone} />
          <span className="truncate">{state.label}</span>
        </span>
      );
    },
  },
  {
    id: "pages",
    label: "Trang",
    width: "56px",
    align: "right",
    cell: (j) => (
      <span className="text-muted-foreground tabular-nums">
        {j.pages === null ? "—" : formatNumber(j.pages)}
      </span>
    ),
  },
  {
    id: "created",
    label: "Gửi lúc",
    width: "110px",
    align: "right",
    cell: (j) => (
      <span className="text-muted-foreground tabular-nums">
        {j.created ? formatDateTime(j.created) : "—"}
      </span>
    ),
  },
];

export function JobsView() {
  const jobs = useStore((s) => s.snapshot?.jobs);

  return (
    <Panel>
      <PanelHeader>
        <ListOrdered className="size-4 text-muted-foreground" />
        <h1 className="font-medium">Lệnh in</h1>
        <span className="text-muted-foreground tabular-nums">{jobs ? jobs.length : ""}</span>
        <RefreshStatus />
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <SnapshotGate>
          {(snapshot) =>
            snapshot.jobs.length === 0 ? (
              <Empty
                title="Không có lệnh in nào"
                detail="Máy in chỉ giữ các lệnh đang chờ hoặc đang in. Lệnh in xong sẽ tự rời khỏi danh sách này."
              />
            ) : (
              <DataTable columns={COLUMNS} rows={snapshot.jobs} rowKey={(j) => j.id} />
            )
          }
        </SnapshotGate>
      </div>
    </Panel>
  );
}
