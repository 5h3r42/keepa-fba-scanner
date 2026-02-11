"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type DashboardSettings = {
  vatRegistered: boolean;
  vatRatePercent: number;
  includeEstimatedVatOnSale: boolean;
  referralRatePercent: number;
  perItemFee: number;
  variableClosingFee: number;
  fulfilmentFee: number;
  digitalServicesFeePercent: number;
  prepFee: number;
  inboundFee: number;
  miscFee: number;
  feeDiscount: number;
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
  includeEstimatedVatOnSale: true,
  referralRatePercent: 15,
  perItemFee: 0.75,
  variableClosingFee: 0,
  fulfilmentFee: 3.04,
  digitalServicesFeePercent: 2,
  prepFee: 0,
  inboundFee: 0,
  miscFee: 0,
  feeDiscount: 0,
  storageFee: 0.03,
  minRoi: 30,
  minProfit: 3,
  maxBsr: 150000,
  onlyShowQualified: false,
};
const SETTINGS_STORAGE_KEY = "keepa-dashboard-settings-v1";

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
  const [loadedFromStorage, setLoadedFromStorage] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!saved) {
        setLoadedFromStorage(true);
        return;
      }

      const parsed = JSON.parse(saved) as Partial<DashboardSettings>;
      setSettings((prev) => ({
        ...prev,
        ...parsed,
      }));
    } catch {
      // Ignore invalid localStorage data and keep defaults.
    } finally {
      setLoadedFromStorage(true);
    }
  }, []);

  useEffect(() => {
    if (!loadedFromStorage) return;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings, loadedFromStorage]);

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
