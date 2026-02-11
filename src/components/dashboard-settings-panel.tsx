"use client";

import { useDashboardSettings } from "@/lib/dashboard-settings";

export function DashboardSettingsPanel() {
  const { settings, setSetting } = useDashboardSettings();

  const numberInputClass =
    "w-full rounded bg-[#0b1b34] border border-[#294571] px-2 py-2 text-sm";

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
        | "maxBsr",
    ) =>
    (value: string) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        setSetting(key, parsed);
      }
    };

  return (
    <section className="mb-6 rounded-lg border border-[#2a456e] bg-[#16315b] p-4">
      <h2 className="mb-3 text-lg font-semibold">Settings</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
        <label className="flex items-center gap-2 pt-7">
          <input
            type="checkbox"
            checked={settings.vatRegistered}
            onChange={(e) => setSetting("vatRegistered", e.target.checked)}
          />
          VAT Registered
        </label>

        <label className="flex items-center gap-2 pt-7">
          <input
            type="checkbox"
            checked={settings.includeEstimatedVatOnSale}
            onChange={(e) =>
              setSetting("includeEstimatedVatOnSale", e.target.checked)
            }
          />
          Include VAT On Sale
        </label>

        <label className="flex items-center gap-2 pt-7">
          <input
            type="checkbox"
            checked={settings.onlyShowQualified}
            onChange={(e) => setSetting("onlyShowQualified", e.target.checked)}
          />
          Show Qualified Only
        </label>

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

        <Field label="Prep Fee (GBP)">
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

        <Field label="Per-Item Fee (GBP)">
          <input
            type="number"
            step="0.01"
            min="0"
            className={numberInputClass}
            value={settings.perItemFee}
            onChange={(e) => onNumberSettingChange("perItemFee")(e.target.value)}
          />
        </Field>

        <Field label="Variable Closing Fee (GBP)">
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

        <Field label="FBA Fulfilment Fee (GBP)">
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

        <Field label="Inbound Fee (GBP)">
          <input
            type="number"
            step="0.01"
            min="0"
            className={numberInputClass}
            value={settings.inboundFee}
            onChange={(e) => onNumberSettingChange("inboundFee")(e.target.value)}
          />
        </Field>

        <Field label="Misc Fee (GBP)">
          <input
            type="number"
            step="0.01"
            min="0"
            className={numberInputClass}
            value={settings.miscFee}
            onChange={(e) => onNumberSettingChange("miscFee")(e.target.value)}
          />
        </Field>

        <Field label="Fee Discount (GBP)">
          <input
            type="number"
            step="0.01"
            min="0"
            className={numberInputClass}
            value={settings.feeDiscount}
            onChange={(e) => onNumberSettingChange("feeDiscount")(e.target.value)}
          />
        </Field>

        <Field label="Storage Fee (GBP)">
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

        <Field label="Min Profit (GBP)">
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
      <span className="text-gray-200">{label}</span>
      {children}
    </label>
  );
}
