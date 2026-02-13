"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getMarketplaceConfig,
  normalizeCurrency,
  normalizeMarketplace,
  type CurrencyCode,
  type Marketplace,
} from "@/lib/marketplace";
import type { TokenBudgetMode } from "@/lib/scan-types";

export type DashboardSettings = {
  vatRegistered: boolean;
  vatRatePercent: number;
  useVatDueModel: boolean;
  costEnteredExVat: boolean;
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
  marketplace: Marketplace;
  currency: CurrencyCode;
  maxLiveFallbackRows: number;
  tokenBudgetMode: TokenBudgetMode;
  tokenHardLimit: number;
  autoSaveServerHistory: boolean;
};

export type DashboardView = "dashboard" | "settings" | "saved";

export type SettingsProfile = {
  id: string;
  name: string;
  createdAt: string;
  settings: DashboardSettings;
};

const defaultSettings: DashboardSettings = {
  vatRegistered: true,
  vatRatePercent: 20,
  useVatDueModel: true,
  costEnteredExVat: true,
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
  marketplace: "UK",
  currency: "GBP",
  maxLiveFallbackRows: 2500,
  tokenBudgetMode: "warn",
  tokenHardLimit: 100,
  autoSaveServerHistory: true,
};

const SETTINGS_STORAGE_KEY = "keepa-dashboard-settings-v2";
const PROFILES_STORAGE_KEY = "keepa-dashboard-settings-profiles-v1";

type DashboardSettingsContextValue = {
  settings: DashboardSettings;
  profiles: SettingsProfile[];
  activeView: DashboardView;
  setActiveView: (view: DashboardView) => void;
  scanModalOpen: boolean;
  setScanModalOpen: (open: boolean) => void;
  saveScanSignal: number;
  requestSaveScan: () => void;
  setSetting: <K extends keyof DashboardSettings>(
    key: K,
    value: DashboardSettings[K],
  ) => void;
  saveProfile: (name: string) => void;
  loadProfile: (id: string) => void;
  deleteProfile: (id: string) => void;
};

const DashboardSettingsContext =
  createContext<DashboardSettingsContextValue | null>(null);

const sanitizeLoadedSettings = (input: Partial<DashboardSettings>): DashboardSettings => {
  const marketplace = normalizeMarketplace(input.marketplace ?? defaultSettings.marketplace);
  const currency = normalizeCurrency(input.currency ?? defaultSettings.currency, marketplace);

  return {
    ...defaultSettings,
    ...input,
    marketplace,
    currency,
    maxLiveFallbackRows: Math.max(0, Math.floor(Number(input.maxLiveFallbackRows ?? defaultSettings.maxLiveFallbackRows))),
    tokenHardLimit: Math.max(0, Math.floor(Number(input.tokenHardLimit ?? defaultSettings.tokenHardLimit))),
    tokenBudgetMode:
      input.tokenBudgetMode === "off" ||
      input.tokenBudgetMode === "warn" ||
      input.tokenBudgetMode === "hard_stop"
        ? input.tokenBudgetMode
        : defaultSettings.tokenBudgetMode,
  };
};

export function DashboardSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DashboardSettings>(defaultSettings);
  const [profiles, setProfiles] = useState<SettingsProfile[]>([]);
  const [activeView, setActiveView] = useState<DashboardView>("dashboard");
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [saveScanSignal, setSaveScanSignal] = useState(0);
  const [loadedFromStorage, setLoadedFromStorage] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<DashboardSettings>;
        setSettings(sanitizeLoadedSettings(parsed));
      }

      const rawProfiles = localStorage.getItem(PROFILES_STORAGE_KEY);
      if (rawProfiles) {
        const parsedProfiles = JSON.parse(rawProfiles) as SettingsProfile[];
        if (Array.isArray(parsedProfiles)) {
          setProfiles(
            parsedProfiles
              .filter((profile) => profile && typeof profile.id === "string")
              .map((profile) => ({
                ...profile,
                settings: sanitizeLoadedSettings(profile.settings),
              })),
          );
        }
      }
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

  useEffect(() => {
    if (!loadedFromStorage) return;
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  }, [profiles, loadedFromStorage]);

  const value = useMemo(
    () => ({
      settings,
      profiles,
      activeView,
      setActiveView,
      scanModalOpen,
      setScanModalOpen,
      saveScanSignal,
      requestSaveScan: () => setSaveScanSignal((prev) => prev + 1),
      setSetting: <K extends keyof DashboardSettings>(
        key: K,
        value: DashboardSettings[K],
      ) => {
        setSettings((prev) => {
          if (key === "marketplace") {
            const marketplace = normalizeMarketplace(value);
            return {
              ...prev,
              marketplace,
              currency: getMarketplaceConfig(marketplace).defaultCurrency,
            };
          }

          if (key === "currency") {
            return {
              ...prev,
              currency: normalizeCurrency(value, prev.marketplace),
            };
          }

          return { ...prev, [key]: value };
        });
      },
      saveProfile: (name: string) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return;

        const profile: SettingsProfile = {
          id: crypto.randomUUID(),
          name: trimmed,
          createdAt: new Date().toISOString(),
          settings,
        };

        setProfiles((prev) => [profile, ...prev].slice(0, 20));
      },
      loadProfile: (id: string) => {
        const profile = profiles.find((item) => item.id === id);
        if (!profile) return;
        setSettings(sanitizeLoadedSettings(profile.settings));
      },
      deleteProfile: (id: string) => {
        setProfiles((prev) => prev.filter((item) => item.id !== id));
      },
    }),
    [settings, profiles, activeView, scanModalOpen, saveScanSignal],
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
