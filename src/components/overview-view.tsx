import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, ExternalLink, LayoutDashboard } from "lucide-react";

import { type PageSlice, PagesDonut, TonerGauge } from "@/components/overview-charts";
import { Panel, PanelHeader } from "@/components/panel";
import { RefreshStatus } from "@/components/refresh-status";
import { SnapshotGate } from "@/components/snapshot-gate";
import { StatusIcon, TONE_FILL, TONE_TEXT } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import {
  type StatusTone,
  counterLabel,
  formatNumber,
  formatUptime,
  issues,
  keyCounters,
  panelMessage,
  paperSize,
  printerState,
  tonerStatus,
  trayName,
  trayStatus,
  wasteStatus,
} from "@/lib/format";
import type { Snapshot, Tray } from "@/lib/printer";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

export function OverviewView() {
  const model = useStore((s) => s.snapshot?.model);

  return (
    <Panel>
      <PanelHeader>
        <LayoutDashboard className="size-4 text-muted-foreground" />
        <h1 className="font-medium">Tổng quan</h1>
        {model && <span className="truncate text-muted-foreground">{model}</span>}
        <RefreshStatus />
      </PanelHeader>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <SnapshotGate>
          {(snapshot) => (
            <div className="mx-auto grid max-w-5xl animate-view-in gap-8 px-8 py-8 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex min-w-0 flex-col gap-8">
                <StatusSection snapshot={snapshot} />
                <SuppliesSection snapshot={snapshot} />
                <TraysSection trays={snapshot.trays} />
              </div>
              <div className="flex min-w-0 flex-col gap-8">
                <CountersSection snapshot={snapshot} />
                <DeviceSection snapshot={snapshot} />
              </div>
            </div>
          )}
        </SnapshotGate>
      </div>
    </Panel>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between gap-4 px-1">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {children}
      </div>
    </section>
  );
}

function StatusLabel({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <StatusIcon tone={tone} />
      <span className={TONE_TEXT[tone]}>{label}</span>
    </span>
  );
}

function Meter({ fill, tone, label }: { fill: number | null; tone: StatusTone; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fill === null ? undefined : Math.round(fill * 100)}
      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted-foreground/15"
    >
      {fill !== null && (
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out-quart", TONE_FILL[tone])}
          style={{ width: `${Math.max(fill * 100, fill > 0 ? 2 : 0)}%` }}
        />
      )}
    </div>
  );
}

function StatusSection({ snapshot }: { snapshot: Snapshot }) {
  const state = printerState(snapshot.state);
  const list = issues(snapshot.reasons);
  // The alert table repeats what the panel shows; once is enough.
  const alerts = snapshot.alerts.filter((a) => a !== snapshot.display);

  return (
    <Section title="Trạng thái">
      <div className="flex items-center gap-3 px-4 py-4">
        <StatusIcon tone={state.tone} className="size-4" />
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold">{state.label}</span>
          {snapshot.display && (
            <span className="truncate text-muted-foreground">
              Màn hình máy: {panelMessage(snapshot.display)}
            </span>
          )}
        </div>
      </div>
      {list.length === 0 && alerts.length === 0 ? (
        <div className="px-4 py-3 text-muted-foreground">Không có cảnh báo nào.</div>
      ) : (
        <ul className="flex flex-col gap-2 px-4 py-3">
          {list.map((issue) => (
            <li key={issue.key} className="flex items-center gap-2" title={issue.key}>
              <StatusIcon tone={issue.tone} />
              <span className={TONE_TEXT[issue.tone]}>{issue.label}</span>
            </li>
          ))}
          {alerts.map((alert) => (
            <li key={alert} className="flex items-center gap-2">
              <StatusIcon tone="done" />
              <span className="text-muted-foreground">{panelMessage(alert)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SuppliesSection({ snapshot }: { snapshot: Snapshot }) {
  const toner = tonerStatus(snapshot);
  const waste = wasteStatus(snapshot);

  return (
    <Section title="Vật tư">
      <div className="flex items-center gap-4 px-4 py-3">
        <TonerGauge level={snapshot.toner} tone={toner.tone} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Mực đen</span>
            <span className="ml-auto">
              <StatusLabel tone={toner.tone} label={toner.label} />
            </span>
          </div>
          {/* Ricoh reports toner in steps, so the gauge moves in jumps rather than smoothly. */}
          <p className="text-muted-foreground">Máy báo mức mực theo từng nấc, không chính xác tới từng %.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="font-medium">Hộp mực thải</span>
        <span className="ml-auto">
          <StatusLabel tone={waste.tone} label={waste.label} />
        </span>
      </div>
    </Section>
  );
}

function TraysSection({ trays }: { trays: Tray[] }) {
  return (
    <Section title="Khay giấy">
      {trays.map((tray) => (
        <TrayRow key={tray.name} tray={tray} />
      ))}
    </Section>
  );
}

function TrayRow({ tray }: { tray: Tray }) {
  const status = trayStatus(tray);
  const name = trayName(tray);
  const amount =
    tray.level >= 0 && tray.capacity > 0
      ? `${formatNumber(tray.level)} / ${formatNumber(tray.capacity)} tờ`
      : `tối đa ${formatNumber(tray.capacity)} tờ`;

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
        <span className="rounded bg-muted px-1.5 text-xs leading-5 text-muted-foreground">
          {paperSize(tray)}
        </span>
        <span className="ml-auto">
          <StatusLabel tone={status.tone} label={status.label} />
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Meter fill={status.fill} tone={status.tone} label={`Giấy còn trong ${name}`} />
        <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">{amount}</span>
      </div>
    </div>
  );
}

/**
 * Chart colors for the share of pages each function printed. Amber and red stay
 * out: on this page they mean "needs attention".
 */
const PAGE_SLICES: { key: "print" | "copy" | "fax"; token: string }[] = [
  { key: "print", token: "--primary" },
  { key: "copy", token: "--chart-2" },
  { key: "fax", token: "--chart-5" },
];

function CountersSection({ snapshot }: { snapshot: Snapshot }) {
  const setView = useStore((s) => s.setView);
  const counters = keyCounters(snapshot.counters);
  const slices: PageSlice[] = PAGE_SLICES.flatMap(({ key, token }) => {
    const value = counters[key];
    return value === undefined ? [] : [{ key, label: counterLabel(key), value, token }];
  });
  const others = (["scanned", "large", "duplex"] as const).filter((k) => counters[k] !== undefined);

  return (
    <Section
      title="Bộ đếm"
      action={
        <button
          onClick={() => setView("counters")}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground [&_svg]:size-3"
        >
          Tất cả {snapshot.counters.length}
          <ArrowRight />
        </button>
      }
    >
      {slices.length > 0 && (
        <div className="flex items-center gap-5 px-4 py-4">
          <PagesDonut slices={slices} total={counters.total} />
          {/* Doubles as the chart's legend, with the numbers the chart only hints at. */}
          <dl className="flex min-w-0 flex-1 flex-col gap-2">
            {slices.map((slice) => (
              <div key={slice.key} className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 translate-y-[-1px] rounded-full"
                  style={{ background: `var(${slice.token})` }}
                />
                <dt className="text-muted-foreground">{slice.label}</dt>
                <dd className="ml-auto tabular-nums">{formatNumber(slice.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {others.length > 0 && (
        <dl className="flex flex-col gap-2 px-4 py-3">
          {others.map((key) => (
            <div key={key} className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{counterLabel(key)}</dt>
              <dd className="tabular-nums">{formatNumber(counters[key] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

function DeviceSection({ snapshot }: { snapshot: Snapshot }) {
  const rows: [string, string | null][] = [
    ["Model", snapshot.model],
    ["Tên máy", snapshot.name],
    ["Số serial", snapshot.serial],
    ["Firmware", snapshot.firmware],
    ["Địa chỉ IP", snapshot.host],
    ["Chạy liên tục", snapshot.uptimeSeconds === null ? null : formatUptime(snapshot.uptimeSeconds)],
  ];

  return (
    <Section title="Thông tin máy">
      <dl className="flex flex-col gap-2 px-4 py-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="truncate tabular-nums select-text" title={value ?? undefined}>
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <div className="px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => openUrl(`http://${snapshot.host}/`)}
        >
          <ExternalLink />
          Mở trang quản trị Web Image Monitor
        </Button>
      </div>
    </Section>
  );
}
