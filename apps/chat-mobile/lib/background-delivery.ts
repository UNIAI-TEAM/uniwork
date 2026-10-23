// What Settings tells a person whose phone may keep calls from reaching UniChat while it is closed (review "Calls,
// push & background": OEM background restrictions), from what the native module reports
// (modules/unichat-calls › BackgroundDelivery.kt): Android's battery optimization or background restriction, which
// Android reports, and a vendor autostart switch, which no vendor reports — so on those brands the way there is
// always shown, with the vendor's own words for it.
import { asRecord } from "./unknown-shape";

export const AUTOSTART_BRANDS = ["xiaomi", "oppo", "vivo", "huawei", "oneplus", "asus"] as const;
export type AutostartBrand = (typeof AUTOSTART_BRANDS)[number];

/** Each brand's own steps, in the i18n source (scripts/i18n-calls.mjs › notify). */
export const AUTOSTART_HINT_KEYS: Record<AutostartBrand, string> = {
  xiaomi: "mobile.notify.autostart_hint_xiaomi",
  oppo: "mobile.notify.autostart_hint_oppo",
  vivo: "mobile.notify.autostart_hint_vivo",
  huawei: "mobile.notify.autostart_hint_huawei",
  oneplus: "mobile.notify.autostart_hint_oneplus",
  asus: "mobile.notify.autostart_hint_asus",
};

export interface BackgroundCallsAdvice {
  /** Android limits UniChat in the background: open its battery page. */
  battery: boolean;
  /** The vendor whose autostart switch may block calls, or null. */
  autostart: AutostartBrand | null;
}

function isBrand(value: unknown): value is AutostartBrand {
  return AUTOSTART_BRANDS.some((brand) => brand === value);
}

/** The rows to show, from the module's report; anything it does not say is read as fine. */
export function backgroundCallsAdvice(status: unknown): BackgroundCallsAdvice {
  const report = asRecord(status) ?? {};
  return {
    battery: report.batteryOptimized === true || report.backgroundRestricted === true,
    autostart: isBrand(report.autostartBrand) ? report.autostartBrand : null,
  };
}
