import { useMemo } from "react";

import { EvilPieChart } from "@/components/evilcharts/charts/recharts-pie-chart";
import { EvilRadialChart } from "@/components/evilcharts/charts/recharts-radial-chart";
import type { ChartConfig } from "@/components/evilcharts/ui/recharts-chart";
import { type StatusTone, formatNumber } from "@/lib/format";

/** The app's theme tokens; the charts take CSS colors, so they follow light and dark. */
const color = (token: string) => ({ light: [`var(${token})`], dark: [`var(${token})`] });

const TONE_COLOR: Record<StatusTone, string> = {
  ok: "--success",
  done: "--muted-foreground",
  pending: "--warning",
  failed: "--destructive",
  unknown: "--muted-foreground",
};

/** Half-circle gauge for the toner level, with the percentage in its middle. */
export function TonerGauge({ level, tone }: { level: number | null; tone: StatusTone }) {
  const config = useMemo(
    () => ({ toner: { label: "Mực đen", colors: color(TONE_COLOR[tone]) } }) satisfies ChartConfig,
    [tone],
  );
  // A stable array keeps Recharts from replaying its entrance on every refresh.
  const data = useMemo(() => [{ name: "toner", value: level ?? 0 }], [level]);

  return (
    <div className="relative h-32 w-44 shrink-0" role="img" aria-label={`Mực đen còn ${level ?? "không rõ"}%`}>
      <EvilRadialChart
        className="h-full w-full"
        data={data}
        nameKey="name"
        config={config}
        variant="semi"
        max={100}
        innerRadius="78%"
        outerRadius="118%"
      >
        <EvilRadialChart.RadialBar dataKey="value" showBackground cornerRadius={6} />
      </EvilRadialChart>
      {/* The semi gauge sits at 70% height; the number fills the bowl above that line. */}
      <div className="pointer-events-none absolute inset-x-0 top-[44%] flex flex-col items-center">
        <span className="text-2xl font-semibold tabular-nums">{level === null ? "—" : `${level}%`}</span>
        <span className="text-xs text-muted-foreground">còn lại</span>
      </div>
    </div>
  );
}

export type PageSlice = { key: string; label: string; value: number; token: string };

/** Donut splitting the machine total by function, with the total in its hole. */
export function PagesDonut({ slices, total }: { slices: PageSlice[]; total: number | undefined }) {
  const config = useMemo(
    () =>
      Object.fromEntries(
        slices.map((s) => [s.key, { label: s.label, colors: color(s.token) }]),
      ) satisfies ChartConfig,
    [slices],
  );
  // Keyed on the numbers: each refresh builds new slices, but only new numbers should redraw.
  const values = slices.map((s) => `${s.key}:${s.value}`).join();
  const data = useMemo(
    () => values.split(",").map((pair) => {
      const [name, value] = pair.split(":");
      return { name, value: Number(value) };
    }),
    [values],
  );

  return (
    <div
      className="relative size-36 shrink-0"
      role="img"
      aria-label={slices.map((s) => `${s.label} ${formatNumber(s.value)} trang`).join(", ")}
    >
      <EvilPieChart className="h-full w-full" data={data} dataKey="value" nameKey="name" config={config}>
        <EvilPieChart.Pie innerRadius="72%" outerRadius="100%" paddingAngle={3} cornerRadius={4} />
      </EvilPieChart>
      {total !== undefined && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums">{formatNumber(total)}</span>
          <span className="text-xs text-muted-foreground">trang</span>
        </div>
      )}
    </div>
  );
}
