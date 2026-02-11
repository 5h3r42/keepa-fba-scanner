"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";

export type DashboardSettings = {
  vatRegistered: boolean;
  vatRatePercent: number;
  prepFee: number;
  inboundFee: number;
  storageFee: number;
  minRoi: number;
  minProfit: number;
  maxBsr: number;
  onlyShowQualified: boolean;
};

export type DashboardView = "dashboard" | "settings";

const defaultSettings: DashboardSettings = {
  vatRegistered: true,
  vatRatePercent: 20,
  prepFee: 0.69,
  inboundFee: 0.3,
  storageFee: 0.15,
  minRoi: 30,
  minProfit: 3,
  maxBsr: 150000,
  onlyShowQualified: false,
};

type DashboardSettingsContextValue = {
  settings: DashboardSettings;
  activeView: DashboardView;
  setActiveView: (view: DashboardView) => void;
  setSetting: <K extends keyof DashboardSettings>(
    key: K,
    value: DashboardSettings[K],
  ) => void;
};

const DashboardSettingsContext =
  createContext<DashboardSettingsContextValue | null>(null);

export function DashboardSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DashboardSettings>(defaultSettings);
  const [activeView, setActiveView] = useState<DashboardView>("dashboard");

  const value = useMemo(
    () => ({
      settings,
      activeView,
      setActiveView,
      setSetting: <K extends keyof DashboardSettings>(
        key: K,
        value: DashboardSettings[K],
      ) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
      },
    }),
    [settings, activeView],
  );

  return (
    <DashboardSettingsContext.Provider value={value}>
      {children}
    </DashboardSettingsContext.Provider>
  );
}

export function useDashboardSettings() {
  const context = useContext(DashboardSettingsContext);
  if (!context) {
    throw new Error(
      "useDashboardSettings must be used within DashboardSettingsProvider",
    );
  }
  return context;
}
