"use client";

import { useMemo, useState } from "react";
import {
  currencyOptions,
  marketplaceOptions,
  type CurrencyCode,
  type Marketplace,
} from "@/lib/marketplace";
import { useDashboardSettings } from "@/lib/dashboard-settings";
import type { TokenBudgetMode } from "@/lib/scan-types";

export function DashboardSettingsPanel() {
  const {
    settings,
    setSetting,
    profiles,
    saveProfile,
    loadProfile,
    deleteProfile,
  } = useDashboardSettings();
  const [profileName, setProfileName] = useState("");

  const numberInputClass =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-offset-zinc-950 placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-600";

  const onNumberSettingChange =
    (
      key:
        | "vatRatePercent"
        | "referralRatePercent"
        | "perItemFee"
        | "variableClosingFee"
        | "fulfilmentFee"
        | "digitalServicesFeePercent"
        | "prepFee"
        | "inboundFee"
        | "miscFee"
        | "feeDiscount"
        | "storageFee"
        | "minRoi"
        | "minProfit"
        | "maxBsr"
        | "maxLiveFallbackRows"
        | "tokenHardLimit",
    ) =>
    (value: string) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        setSetting(key, parsed);
      }
    };

  const profileOptions = useMemo(
    () =>
      profiles.map((profile) => ({
        id: profile.id,
        label: `${profile.name} (${new Date(profile.createdAt).toLocaleDateString()})`,
      })),
    [profiles],
  );

  return (
    <section className="mb-6 space-y-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-lg font-semibold tracking-tight">Settings</h2>

      <section className="rounded-lg border border-zinc-800 bg-black p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Marketplace & Token Budget</h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
          <Field label="Marketplace">
            <select
              className={numberInputClass}
              value={settings.marketplace}
              onChange={(e) => setSetting("marketplace", e.target.value as Marketplace)}
            >
              {marketplaceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Currency">
            <select
              className={numberInputClass}
              value={settings.currency}
              onChange={(e) => setSetting("currency", e.target.value as CurrencyCode)}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Token Budget Mode">
            <select
              className={numberInputClass}
              value={settings.tokenBudgetMode}
              onChange={(e) =>
                setSetting("tokenBudgetMode", e.target.value as TokenBudgetMode)
              }
            >
              <option value="off">Off</option>
              <option value="warn">Warn</option>
              <option value="hard_stop">Hard stop</option>
            </select>
          </Field>

          <Field label="Token Hard Limit">
            <input
              type="number"
              step="1"
              min="0"
              className={numberInputClass}
              value={settings.tokenHardLimit}
              onChange={(e) => onNumberSettingChange("tokenHardLimit")(e.target.value)}
            />
          </Field>

          <Field label="Max Live Fallback Rows">
            <input
              type="number"
              step="1"
              min="0"
              className={numberInputClass}
              value={settings.maxLiveFallbackRows}
              onChange={(e) =>
                onNumberSettingChange("maxLiveFallbackRows")(e.target.value)
              }
            />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-black p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Fees & Filters</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
          <Field label="VAT Rate (%)">
            <input
              type="number"
              step="0.1"
              min="0"
              className={numberInputClass}
              value={settings.vatRatePercent}
              onChange={(e) => onNumberSettingChange("vatRatePercent")(e.target.value)}
            />
          </Field>

          <Field label="Prep Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.prepFee}
              onChange={(e) => onNumberSettingChange("prepFee")(e.target.value)}
            />
          </Field>

          <Field label="Referral Rate (%)">
            <input
              type="number"
              step="0.1"
              min="0"
              className={numberInputClass}
              value={settings.referralRatePercent}
              onChange={(e) =>
                onNumberSettingChange("referralRatePercent")(e.target.value)
              }
            />
          </Field>

          <Field label="Per-Item Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.perItemFee}
              onChange={(e) => onNumberSettingChange("perItemFee")(e.target.value)}
            />
          </Field>

          <Field label="Variable Closing Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.variableClosingFee}
              onChange={(e) =>
                onNumberSettingChange("variableClosingFee")(e.target.value)
              }
            />
          </Field>

          <Field label="FBA Fulfilment Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.fulfilmentFee}
              onChange={(e) => onNumberSettingChange("fulfilmentFee")(e.target.value)}
            />
          </Field>

          <Field label="Digital Services Fee (%)">
            <input
              type="number"
              step="0.1"
              min="0"
              className={numberInputClass}
              value={settings.digitalServicesFeePercent}
              onChange={(e) =>
                onNumberSettingChange("digitalServicesFeePercent")(e.target.value)
              }
            />
          </Field>

          <Field label="Inbound Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.inboundFee}
              onChange={(e) => onNumberSettingChange("inboundFee")(e.target.value)}
            />
          </Field>

          <Field label="Misc Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.miscFee}
              onChange={(e) => onNumberSettingChange("miscFee")(e.target.value)}
            />
          </Field>

          <Field label="Fee Discount">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.feeDiscount}
              onChange={(e) => onNumberSettingChange("feeDiscount")(e.target.value)}
            />
          </Field>

          <Field label="Storage Fee">
            <input
              type="number"
              step="0.01"
              min="0"
              className={numberInputClass}
              value={settings.storageFee}
              onChange={(e) => onNumberSettingChange("storageFee")(e.target.value)}
            />
          </Field>

          <Field label="Min ROI (%)">
            <input
              type="number"
              step="0.1"
              className={numberInputClass}
              value={settings.minRoi}
              onChange={(e) => onNumberSettingChange("minRoi")(e.target.value)}
            />
          </Field>

          <Field label="Min Profit">
            <input
              type="number"
              step="0.01"
              className={numberInputClass}
              value={settings.minProfit}
              onChange={(e) => onNumberSettingChange("minProfit")(e.target.value)}
            />
          </Field>

          <Field label="Max BSR">
            <input
              type="number"
              step="1"
              min="1"
              className={numberInputClass}
              value={settings.maxBsr}
              onChange={(e) => onNumberSettingChange("maxBsr")(e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-black p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Behavior</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
          <SwitchField
            label="VAT Registered"
            checked={settings.vatRegistered}
            onChange={(checked) => setSetting("vatRegistered", checked)}
          />

          <SwitchField
            label="Use VAT Due Model"
            checked={settings.useVatDueModel}
            onChange={(checked) => setSetting("useVatDueModel", checked)}
          />

          <SwitchField
            label="Cost Entered Ex-VAT"
            checked={settings.costEnteredExVat}
            onChange={(checked) => setSetting("costEnteredExVat", checked)}
          />

          <SwitchField
            label="Include VAT On Sale"
            checked={settings.includeEstimatedVatOnSale}
            onChange={(checked) => setSetting("includeEstimatedVatOnSale", checked)}
          />

          <SwitchField
            label="Show Qualified Only"
            checked={settings.onlyShowQualified}
            onChange={(checked) => setSetting("onlyShowQualified", checked)}
          />

          <SwitchField
            label="Auto Save Server History"
            checked={settings.autoSaveServerHistory}
            onChange={(checked) => setSetting("autoSaveServerHistory", checked)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-black p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Settings Profiles</h3>

        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Profile name"
            className={`${numberInputClass} max-w-xs`}
          />
          <button
            type="button"
            onClick={() => {
              saveProfile(profileName);
              setProfileName("");
            }}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          >
            Save Current Profile
          </button>
        </div>

        {profileOptions.length === 0 ? (
          <p className="text-xs text-zinc-400">No saved profiles yet.</p>
        ) : (
          <div className="space-y-2">
            {profileOptions.map((profile) => (
              <div
                key={profile.id}
                className="flex flex-wrap items-center justify-between rounded-md border border-zinc-800 px-3 py-2"
              >
                <span className="text-sm text-zinc-200">{profile.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadProfile(profile.id)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100"
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProfile(profile.id)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left"
    >
      <span
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
          checked ? "bg-zinc-300" : "bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-6 w-6 transform rounded-full bg-black transition ${
            checked ? "translate-x-6" : "translate-x-0.5"
          }`}
        />
      </span>
      <span className="text-zinc-100">{label}</span>
    </button>
  );
}
