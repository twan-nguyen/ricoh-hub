import { ChartColumn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EvilBarChart } from "@/components/evilcharts/charts/recharts-bar-chart";
import { EvilLineChart } from "@/components/evilcharts/charts/recharts-line-chart";
import type { ChartConfig } from "@/components/evilcharts/ui/recharts-chart";
import { Segmented } from "@/components/form-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { Empty } from "@/components/snapshot-gate";
import { formatBucketDate, formatDayMonth, formatNumber } from "@/lib/format";
import { type HistoryRange, type HistoryView, getHistory } from "@/lib/printer";
import { errorMessage } from "@/lib/utils";
import { useStore } from "@/store";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "week", label: "7 ngày" },
  { value: "month", label: "30 ngày" },
  { value: "year", label: "12 tháng" },
];

/** Until the app has watched this long, the charts are mostly empty and say so. */
const COLLECTING_MS = 3 * 24 * 60 * 60 * 1000;

const color = (token: string) => ({ light: [`var(${token})`], dark: [`var(${token})`] });

/** The same colors as the dashboard's donut, so a function keeps its color across views. */
const PAGES_CONFIG = {
  print: { label: "In", colors: color("--primary") },
  copy: { label: "Photocopy", colors: color("--chart-2") },
  fax: { label: "Fax", colors: color("--chart-5") },
} satisfies ChartConfig;

const TONER_CONFIG = {
  toner: { label: "Mực đen (%)", colors: color("--chart-1") },
} satisfies ChartConfig;

const RANGE_KEY = "ricoh-hub:stats-range";

function savedRange(): HistoryRange {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (RANGES.some((r) => r.value === saved)) return saved as HistoryRange;
  } catch {
    // Storage can be unavailable; the default range is fine.
  }
  return "week";
}

/** Pages per day and toner over time, from the readings the app keeps while it runs. */
export function StatsView() {
  const updatedAt = useStore((s) => s.updatedAt);
  const [range, setRange] = useState<HistoryRange>(savedRange);
  const [view, setView] = useState<HistoryView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read again when the range changes and after each new reading of the printer.
  useEffect(() => {
    let current = true;
    getHistory(range).then(
      (next) => current && (setView(next), setError(null)),
      (err) => current && setError(errorMessage(err)),
    );
    return () => {
      current = false;
    };
  }, [range, updatedAt]);

  function pick(next: HistoryRange) {
    setRange(next);
    try {
      localStorage.setItem(RANGE_KEY, next);
    } catch {
      // Remembering the range is a convenience only.
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <ChartColumn className="size-4 text-muted-foreground" />
        <h1 className="font-medium">Thống kê</h1>
        <div className="ml-auto shrink-0">
          <Segmented label="Khoảng thời gian" value={range} options={RANGES} onChange={pick} />
        </div>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <Empty title="Không đọc được lịch sử" detail={error} />
        ) : view ? (
          <Charts view={view} range={range} />
        ) : null}
      </div>
    </Panel>
  );
}

function Charts({ view, range }: { view: HistoryView; range: HistoryRange }) {
  const rows = useMemo(
    () =>
      view.buckets.map((b) => ({
        // A star marks a bar that does not start at the day before's close.
        label: formatBucketDate(b.date) + (b.since === null ? "" : "*"),
        print: b.print,
        copy: b.copy,
        fax: b.fax,
        toner: b.toner,
      })),
    [view],
  );
  const sum = (key: "total" | "print" | "copy" | "fax") =>
    view.buckets.reduce((total, b) => total + (b[key] ?? 0), 0);
  const days = view.buckets.filter((b) => b.total !== null).length;
  const marked = view.buckets.some((b) => b.total !== null && b.since !== null);
  const collecting = view.firstAt === null || Date.now() - view.firstAt < COLLECTING_MS;

  if (view.firstAt === null) {
    return (
      <Empty
        title="Chưa có số liệu"
        detail="Ricoh Hub ghi bộ đếm của máy in mỗi khi đọc được máy. Biểu đồ sẽ có số sau lần đọc đầu tiên."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl animate-view-in flex-col gap-8 px-8 py-8">
      {collecting && (
        <p className="rounded-lg border border-border px-4 py-3 text-muted-foreground">
          Đang thu thập số liệu, bắt đầu từ{" "}
          {formatDayMonth(new Date(view.firstAt))}.
          Biểu đồ đầy dần khi app chạy thêm vài ngày; quay lại sau nhé.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <Stat label="Tổng số trang" value={sum("total")} />
        <Stat label="In" value={sum("print")} />
        <Stat label="Photocopy" value={sum("copy")} />
        <Stat
          label={range === "year" ? "Trung bình mỗi tháng" : "Trung bình mỗi ngày"}
          value={days > 0 ? Math.round(sum("total") / days) : 0}
        />
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">Số trang</h2>
        <div className="rounded-lg border border-border px-2 pt-4 pb-2">
          <EvilBarChart
            className="h-64 w-full"
            data={rows}
            config={PAGES_CONFIG}
            stackType="stacked"
            barRadius={3}
          >
            <EvilBarChart.Grid />
            <EvilBarChart.XAxis dataKey="label" />
            <EvilBarChart.YAxis tickFormatter={(v: number) => formatNumber(v)} />
            <EvilBarChart.Tooltip />
            <EvilBarChart.Legend />
            <EvilBarChart.Bar dataKey="print" />
            <EvilBarChart.Bar dataKey="copy" />
            <EvilBarChart.Bar dataKey="fax" />
          </EvilBarChart>
        </div>
        {marked && (
          <p className="px-1 text-xs text-muted-foreground">
            * Không tính đúng từ đầu ngày: gồm cả những ngày app không chạy trước đó, hoặc chỉ tính từ lúc app
            bắt đầu chạy.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">Mực đen</h2>
        <div className="rounded-lg border border-border px-2 pt-4 pb-2">
          <EvilLineChart className="h-48 w-full" data={rows} config={TONER_CONFIG} curveType="stepAfter">
            <EvilLineChart.Grid />
            <EvilLineChart.XAxis dataKey="label" />
            <EvilLineChart.YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <EvilLineChart.Tooltip />
            <EvilLineChart.Line dataKey="toner" connectNulls />
          </EvilLineChart>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
    </div>
  );
}
