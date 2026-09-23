"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { SettingsBadge, SettingsRow } from "./settings-layout";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

function formatBytes(n: number, locale: string): string {
  let value = n;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: BYTE_UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(value);
}

/**
 * "12 thành viên", "1,5 GB". The unit is whatever the server meters in;
 * one it has not been taught yet still reads, as its raw name.
 */
function quantity(n: number, unit: string | undefined, locale: string, t: Translate): { amount: string; unit: string } {
  if (unit === "bytes") return { amount: formatBytes(n, locale), unit: "" };
  return {
    amount: n.toLocaleString(locale),
    unit: unit ? t(`units.${unit}`, { count: n, defaultValue: unit }) : "",
  };
}

/** Same thresholds the server notifies at (80 %, 100 %). */
function meterTone(percent: number): { bar: string; badge: "destructive" | "warning" | null } {
  if (percent >= 100) return { bar: "bg-destructive", badge: "destructive" };
  if (percent >= 80) return { bar: "bg-warning", badge: "warning" };
  return { bar: "bg-primary", badge: null };
}

/**
 * One quota: a meter when it has a ceiling, a compact line when it does not.
 * Shared by Thanh toán (every quota of the plan) and AI (the token quota), so
 * the same number reads the same way in both places.
 */
export function QuotaMeterRow({
  label,
  description,
  used,
  limit,
  unit,
}: {
  label: string;
  description?: string;
  used: number;
  /** null = no ceiling. 0 is a real ceiling: nothing may be created. */
  limit: number | null;
  unit?: string;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  const locale = i18n.language;

  if (limit === null) {
    const u = quantity(used, unit, locale, t);
    return (
      <SettingsRow label={label} description={description} size="none" className="min-h-12 py-2.5">
        <span className="block text-caption text-muted-foreground tabular-nums sm:text-right">
          {u.unit
            ? t("usage_unbounded_unit", { used: u.amount, unit: u.unit })
            : t("usage_unbounded_plain", { used: u.amount })}
        </span>
      </SettingsRow>
    );
  }

  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const remaining = Math.max(0, limit - used);
  const tone = meterTone(percent);
  const usedQ = quantity(used, unit, locale, t);
  const limitQ = quantity(limit, unit, locale, t);
  const usedText = t("usage_of", { used: usedQ.amount, limit: limitQ.amount, unit: limitQ.unit }).trim();
  const remainingText = percent >= 100 ? t("usage_full") : t("usage_remaining", { n: quantity(remaining, unit, locale, t).amount });

  return (
    <SettingsRow label={label} description={description} size="none">
      <div className="flex w-full flex-col gap-1.5 sm:w-72">
        <span className="flex items-center justify-between gap-2 text-caption">
          <span className="tabular-nums">{usedText}</span>
          {tone.badge ? (
            <SettingsBadge tone={tone.badge} className="tabular-nums">
              {remainingText}
            </SettingsBadge>
          ) : (
            <span className="text-muted-foreground tabular-nums">{remainingText}</span>
          )}
        </span>
        {/* Plain bar: the registry Progress cannot recolour its indicator. */}
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={usedText}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className={cn("h-full rounded-full transition-[width]", tone.bar)} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </SettingsRow>
  );
}
