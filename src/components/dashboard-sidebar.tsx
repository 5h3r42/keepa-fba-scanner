"use client";

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  LayoutDashboard,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDashboardSettings } from "@/lib/dashboard-settings";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "keepa-sidebar-collapsed-v1";

export function DashboardSidebar() {
  const { activeView, setActiveView, setScanModalOpen } = useDashboardSettings();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore localStorage access issues.
    }
  }, [collapsed]);

  const sidebarButtonClass =
    "w-full rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 transition hover:bg-zinc-800";
  const iconOnlyButtonClass =
    "inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100";
  const CollapseIcon = collapsed ? ChevronRight : ChevronLeft;

  return (
    <aside
      className={`h-full shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 transition-all duration-200 ${
        collapsed ? "w-20 p-3" : "w-72 p-6"
      }`}
    >
      <div
        className={`mb-6 flex ${
          collapsed ? "flex-col items-center gap-3" : "items-start justify-between gap-2"
        }`}
      >
        <img
          src="/logo-icon-scoutswitch.svg"
          alt="ScoutSwitch icon"
          className={collapsed ? "h-10 w-10" : "h-24 w-24"}
        />
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className={iconOnlyButtonClass}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <CollapseIcon aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <nav className="space-y-2">
        <SidebarItem
          label="Dashboard"
          icon={LayoutDashboard}
          collapsed={collapsed}
          active={activeView === "dashboard"}
          onClick={() => setActiveView("dashboard")}
        />
        <button
          type="button"
          onClick={() => {
            setActiveView("dashboard");
            setScanModalOpen(true);
          }}
          aria-label={collapsed ? "New Scan" : undefined}
          title={collapsed ? "New Scan" : undefined}
          className={`${sidebarButtonClass} ${
            collapsed
              ? "flex h-11 items-center justify-center px-0 py-0"
              : "px-4 py-3 text-left"
          }`}
        >
          <span className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
            <CirclePlus aria-hidden="true" className={`${collapsed ? "h-5 w-5" : "h-4 w-4"} shrink-0`} />
            {!collapsed && <span>New Scan</span>}
          </span>
        </button>
        <SidebarItem
          label="Saved Scans"
          icon={Archive}
          collapsed={collapsed}
          active={activeView === "saved"}
          onClick={() => setActiveView("saved")}
        />
        <SidebarItem
          label="Settings"
          icon={SettingsIcon}
          collapsed={collapsed}
          active={activeView === "settings"}
          onClick={() => setActiveView("settings")}
        />
      </nav>
    </aside>
  );
}

function SidebarItem(props: {
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const { label, icon: Icon, collapsed, active, onClick } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={`w-full rounded-xl border transition ${
        active
          ? "border-zinc-600 bg-zinc-800 text-zinc-100"
          : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
      } ${
        collapsed
          ? "flex h-11 items-center justify-center px-0 py-0"
          : "px-4 py-3 text-left text-sm font-medium"
      }`}
    >
      <span className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
        <Icon aria-hidden="true" className={`${collapsed ? "h-5 w-5" : "h-4 w-4"} shrink-0`} />
        {!collapsed && <span>{label}</span>}
      </span>
    </button>
  );
}
