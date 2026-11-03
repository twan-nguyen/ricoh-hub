import { ListOrdered, X } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
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

/** Pending, held, printing or paused: states the printer still lets a job leave. */
const CANCELABLE = new Set([3, 4, 5, 6]);

export function JobsView() {
  const jobs = useStore((s) => s.snapshot?.jobs);
  const cancelJob = useStore((s) => s.cancelJob);
  // The job stays set while the dialog fades out, so its title does not go blank.
  const [canceling, setCanceling] = useState<Job | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const columns = useMemo<Column<Job>[]>(
    () => [
      ...COLUMNS,
      {
        id: "actions",
        label: "",
        width: "28px",
        align: "right",
        cell: (j) =>
          CANCELABLE.has(j.state) && (
            <button
              onClick={() => {
                setCanceling(j);
                setConfirmOpen(true);
              }}
              aria-label={`Hủy lệnh in ${j.name ?? j.id}`}
              title="Hủy lệnh in"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-destructive/15 hover:text-destructive [&_svg]:size-3.5"
            >
              <X />
            </button>
          ),
      },
    ],
    [],
  );

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
              <DataTable columns={columns} rows={snapshot.jobs} rowKey={(j) => j.id} />
            )
          }
        </SnapshotGate>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Hủy lệnh in “${canceling?.name ?? `#${canceling?.id}`}”?`}
        description="Máy in sẽ bỏ lệnh này. Những trang đã in ra thì không lấy lại được."
        confirmLabel="Hủy lệnh in"
        cancelLabel="Giữ lại"
        destructive
        onConfirm={() => (canceling ? cancelJob(canceling.id) : Promise.resolve())}
      />
    </Panel>
  );
}
