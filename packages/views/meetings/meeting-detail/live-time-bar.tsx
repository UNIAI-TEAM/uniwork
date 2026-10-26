"use client";
import { useTranslation } from "react-i18next";
import { clock, durationWords } from "./format";

const MINUTE = 60_000;
const timeCls = "font-mono text-caption font-medium";

/**
 * The live time bar (kit `.timebar`): start clock, elapsed in success ink, the
 * rest of the window dashed, end clock. Past the end the bar fills to the end
 * clock and the overtime runs on after it as a warning hatch, in proportion.
 */
export function LiveTimeBar({ startIso, endIso, now }: { startIso: string; endIso: string; now: number }) {
  const { t } = useTranslation();
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const from = clock(startIso);
  const to = clock(endIso);
  const elapsed = Math.max(0, now - start);
  const over = Math.max(0, now - end);
  if (over > 0) {
    return (
      <div
        role="img"
        aria-label={t("meetings.detail.header.timebarOver", {
          start: from,
          end: to,
          over: durationWords(over / MINUTE, t),
        })}
        className="mt-2 flex max-w-170 items-center gap-2 text-muted-foreground"
      >
        <span className={timeCls}>{from}</span>
        <span className="h-1 rounded-xs bg-success" style={{ flexGrow: end - start }} />
        {/* Past its end, the end clock is ink (kit `.timebar-end`). */}
        <span className={`${timeCls} text-foreground`}>{to}</span>
        <span
          className="h-1 rounded-xs bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--warning)_35%,transparent)_0_4px,transparent_4px_8px)]"
          style={{ flexGrow: over }}
        />
      </div>
    );
  }
  const pct = Math.min(100, (elapsed / (end - start)) * 100);
  return (
    <div
      role="img"
      aria-label={t("meetings.detail.header.timebar", {
        start: from,
        end: to,
        elapsed: durationWords(elapsed / MINUTE, t),
        left: durationWords((end - now) / MINUTE, t),
      })}
      className="mt-3 flex max-w-170 items-center gap-2 text-muted-foreground [[data-panel=roll]_&]:mt-2"
    >
      <span className={timeCls}>{from}</span>
      <span className="relative flex h-1 flex-1 items-center">
        <span className="h-1 rounded-xs bg-success" style={{ width: `${pct}%` }} />
        <span className="flex-1 border-t border-dashed border-border" />
      </span>
      <span className={timeCls}>{to}</span>
    </div>
  );
}
