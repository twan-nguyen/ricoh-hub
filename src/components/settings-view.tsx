import { open } from "@tauri-apps/plugin-dialog";
import { Check, Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { Panel, PanelHeader } from "@/components/panel";
import { Segmented } from "@/components/form-controls";
import { SettingsHeading } from "@/components/settings-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getScanFolder } from "@/lib/printer";
import { errorMessage } from "@/lib/utils";
import { useStore } from "@/store";

export function SettingsView() {
  return (
    <Panel>
      <PanelHeader>
        <Settings className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">Cài đặt</span>
        <span className="text-muted-foreground/60">/</span>
        <h1 className="font-medium">Chung</h1>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="mx-auto flex max-w-2xl animate-view-in flex-col gap-6 px-8 py-12">
          <SettingsHeading
            title="Máy in"
            description="Ricoh Hub đọc máy in qua SNMP và IPP ở địa chỉ này. Chỉ đọc, không đổi gì trên máy."
          />
          <PrinterForm />

          <SettingsHeading
            title="Ứng dụng"
            description="Đóng cửa sổ thì Ricoh Hub vẫn chạy trên menu bar và tiếp tục theo dõi máy in. Thoát hẳn bằng ⌘Q hoặc menu của icon trên menu bar."
          />
          <AppForm />
        </section>
      </div>
    </Panel>
  );
}

function PrinterForm() {
  const { settings, saveSettings } = useStore();
  const [host, setHost] = useState("");
  const [community, setCommunity] = useState("");
  const [scanFolder, setScanFolder] = useState<string | null>(null);
  // The folder scans go to when none is chosen, shown so the default is not a mystery.
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Keyed on the fields this form edits, so saving another setting keeps unsaved edits here.
  useEffect(() => {
    if (!settings) return;
    setHost(settings.host);
    setCommunity(settings.community);
    setScanFolder(settings.scanFolder);
    if (!settings.scanFolder) getScanFolder().then(setDefaultFolder, () => setDefaultFolder(null));
  }, [settings?.host, settings?.community, settings?.scanFolder]);

  const changed =
    settings &&
    (host !== settings.host || community !== settings.community || scanFolder !== settings.scanFolder);

  async function pickFolder() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Chọn thư mục lưu file scan",
      defaultPath: scanFolder ?? defaultFolder ?? undefined,
    });
    if (picked) {
      setScanFolder(picked);
      setSaved(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (!settings) return;
      await saveSettings({ ...settings, host, community, scanFolder });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-lg border border-border p-5">
      <Field
        id="host"
        label="Địa chỉ IP"
        hint="Xem trên máy in ở mục Settings › Network, hoặc in trang cấu hình."
      >
        <Input
          id="host"
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            setSaved(false);
          }}
          placeholder="192.168.1.103"
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
      </Field>
      <Field
        id="community"
        label="SNMP community"
        hint="Để public nếu chưa ai đổi trên máy in. Chỉ dùng để đọc."
      >
        <Input
          id="community"
          value={community}
          onChange={(e) => {
            setCommunity(e.target.value);
            setSaved(false);
          }}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
      </Field>

      <Field
        id="scan-folder"
        label="Thư mục lưu file scan"
        hint="File scan được lưu thẳng vào đây, tên theo giờ scan."
      >
        <div className="flex items-center gap-2">
          <span
            id="scan-folder"
            className="flex h-8 min-w-0 flex-1 items-center truncate rounded-lg border border-input px-2.5 font-mono text-muted-foreground select-text"
            title={scanFolder ?? defaultFolder ?? undefined}
          >
            {scanFolder ?? defaultFolder ?? "Downloads/Ricoh Scans"}
          </span>
          <Button type="button" variant="outline" onClick={pickFolder}>
            Chọn…
          </Button>
          {scanFolder && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setScanFolder(null);
                setSaved(false);
              }}
            >
              Dùng mặc định
            </Button>
          )}
        </div>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !changed}>
          {busy ? "Đang lưu…" : "Lưu và đọc lại"}
        </Button>
        {saved && (
          <span className="flex animate-fade-in items-center gap-1.5 text-success">
            <Check className="size-4" />
            Đã lưu
          </span>
        )}
      </div>
      {error && <p className="animate-fade-in text-destructive">{error}</p>}
    </form>
  );
}

/** Saved as soon as it changes; there is nothing to type, so no Save button. */
function AppForm() {
  const { settings, saveSettings } = useStore();
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;

  async function setLaunchAtLogin(value: "on" | "off") {
    if (!settings) return;
    setError(null);
    try {
      await saveSettings({ ...settings, launchAtLogin: value === "on" });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border p-5">
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Mở khi đăng nhập</span>
        <Segmented
          label="Mở khi đăng nhập"
          value={settings.launchAtLogin ? "on" : "off"}
          options={[
            { value: "on", label: "Bật" },
            { value: "off", label: "Tắt" },
          ]}
          onChange={setLaunchAtLogin}
        />
        <p className="text-xs text-muted-foreground">
          {import.meta.env.DEV
            ? "Bản đang phát triển không đổi mục này trong macOS; chỉ bản đã đóng gói mới áp dụng."
            : "Ricoh Hub chạy ẩn trên menu bar ngay khi bạn đăng nhập máy Mac."}
        </p>
      </div>
      {error && <p className="animate-fade-in text-destructive">{error}</p>}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
