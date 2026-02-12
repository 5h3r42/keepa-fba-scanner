"use client";

import { useDashboardSettings } from "@/lib/dashboard-settings";

export function DashboardSidebar() {
  const { activeView, setActiveView, setScanModalOpen } = useDashboardSettings();
  const sidebarButtonClass =
    "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-zinc-100 transition hover:bg-zinc-800";

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 p-6 overflow-y-auto">
      <div className="mb-8">
        <div className="text-2xl font-semibold tracking-tight text-zinc-100">FBA AI</div>
        <p className="mt-1 text-xs text-zinc-400">Wholesale Scanner</p>
      </div>

      <button
        type="button"
        onClick={() => {
          setActiveView("dashboard");
          setScanModalOpen(true);
        }}
        className={`mb-4 ${sidebarButtonClass}`}
      >
        New Scan
      </button>

      <nav className="space-y-2">
        <SidebarItem
          label="Dashboard"
          active={activeView === "dashboard"}
          onClick={() => setActiveView("dashboard")}
        />
        <SidebarItem
          label="Saved Scans"
          active={activeView === "saved"}
          onClick={() => setActiveView("saved")}
        />
        <SidebarItem
          label="Settings"
          active={activeView === "settings"}
          onClick={() => setActiveView("settings")}
        />
      </nav>
    </aside>
  );
}

function SidebarItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
        active
          ? "border-zinc-600 bg-zinc-800 text-zinc-100"
          : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}
