"use client";

import { useDashboardSettings } from "@/lib/dashboard-settings";

export function DashboardSidebar() {
  const { activeView, setActiveView, setScanModalOpen } = useDashboardSettings();

  return (
    <aside className="w-72 shrink-0 bg-[#0f223f] border-r border-[#1e365d] p-6 overflow-y-auto">
      <div className="mb-8">
        <div className="text-2xl font-bold text-blue-400">FBA AI</div>
      </div>

      <nav className="space-y-3 mb-6">
        <SidebarItem
          label="Dashboard"
          active={activeView === "dashboard"}
          onClick={() => setActiveView("dashboard")}
        />
      </nav>

      <button
        type="button"
        onClick={() => {
          setActiveView("dashboard");
          setScanModalOpen(true);
        }}
        className="w-full mt-3 px-4 py-2 rounded-lg text-left transition bg-[#1e365d] hover:bg-[#24416d]"
      >
        Scan
      </button>

      <button
        type="button"
        onClick={() => setActiveView("settings")}
        className={`w-full mt-3 px-4 py-2 rounded-lg text-left transition ${
          activeView === "settings"
            ? "bg-[#24416d] ring-1 ring-blue-300"
            : "bg-[#1e365d] hover:bg-[#24416d]"
        }`}
      >
        Settings
      </button>
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
      className={`w-full text-left px-4 py-3 rounded-lg cursor-pointer transition ${
        active ? "bg-[#1e365d]" : "hover:bg-[#162c4f]"
      }`}
    >
      {label}
    </button>
  );
}
