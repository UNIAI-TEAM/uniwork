"use client";

/**
 * B4ui (UNI-927) - the advance-timing control (B4: advance timing).
 *
 * Two mutually exclusive intents, matching PowerPoint's Transitions tab:
 *   - "On mouse click"  -> no auto-advance timer (set_advance_time ms = null);
 *   - "Automatically after N seconds" -> an auto-advance timer in whole ms.
 *
 * The control owns the draft text and reports ONE committed value through
 * `onCommit`; it never talks to the engine. An invalid field (negative, NaN,
 * non-numeric) blocks the commit and shows the reason instead of sending a
 * value the engine half would refuse.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { cn } from "@uniwork/ui/lib/utils";
import { advanceMsToSecondsText, advanceSecondsIsValid, parseAdvanceSeconds } from "./transition-timing";

export interface PptxAdvanceTimingProps {
  /** Current auto-advance time in ms; null = no timer ("on mouse click"). */
  ms: number | null;
  /** Commit one advance time (null clears the timer). Absent leaves the control
   *  read-only; the panel passes undefined when no edit port is bound. */
  onCommit?: (ms: number | null) => void;
  disabled?: boolean;
  /** An apply is in flight; the control stays in the DOM but inert. */
  pending?: boolean;
  className?: string;
}

export function PptxAdvanceTiming({ ms, onCommit, disabled = false, pending = false, className }: PptxAdvanceTimingProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.transitions" });
  const [mode, setMode] = useState<"off" | "on">(ms === null ? "off" : "on");
  const [seconds, setSeconds] = useState<string>(advanceMsToSecondsText(ms));

  // Re-sync when the reported timer changes (a slide switch, an undo, a
  // read-back): the field must show the deck's value, not a stale draft.
  useEffect(() => {
    setMode(ms === null ? "off" : "on");
    setSeconds(advanceMsToSecondsText(ms));
  }, [ms]);

  const invalid = mode === "on" && !advanceSecondsIsValid(seconds);
  const inert = disabled || pending;

  const commit = () => {
    if (inert || invalid || !onCommit) return;
    if (mode === "off") {
      onCommit(null);
      return;
    }
    const parsed = parseAdvanceSeconds(seconds);
    if (parsed.kind === "ms") onCommit(parsed.ms);
    else if (parsed.kind === "clear") onCommit(null);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)} data-pptx-advance-timing>
      <span className="text-label font-medium text-foreground">{t("advance_label")}</span>
      <RadioGroup
        aria-label={t("advance_label")}
        value={mode}
        onValueChange={(value) => {
          if (inert) return;
          if (value !== "off" && value !== "on") return;
          setMode(value);
          // Switching to "off" clears the timer right away; switching to "on"
          // waits for a seconds value so the deck never gets a stray 0 s timer.
          if (value === "off") onCommit?.(null);
        }}
        className="gap-1.5"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem
            value="off"
            id="pptx-advance-off"
            aria-label={t("advance_off")}
            disabled={inert}
            nativeButton
            render={<button type="button" />}
          />
          <Label htmlFor="pptx-advance-off" className="text-body font-normal">{t("advance_off")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem
            value="on"
            id="pptx-advance-on"
            aria-label={t("advance_on")}
            disabled={inert}
            nativeButton
            render={<button type="button" />}
          />
          <Label htmlFor="pptx-advance-on" className="text-body font-normal">{t("advance_on")}</Label>
        </div>
      </RadioGroup>
      {mode === "on" ? (
        <div className="flex flex-col gap-1 pl-6">
          <Label htmlFor="pptx-advance-seconds" className="text-caption text-muted-foreground">{t("advance_seconds")}</Label>
          <Input
            id="pptx-advance-seconds"
            type="text"
            inputMode="decimal"
            value={seconds}
            disabled={inert}
            aria-invalid={invalid || undefined}
            aria-label={t("advance_seconds")}
            className="h-7 w-24"
            onChange={(event) => setSeconds(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
          />
          {invalid ? (
            <p role="alert" className="text-caption text-destructive">{t("advance_invalid")}</p>
          ) : null}
        </div>
      ) : null}
      {pending ? <span role="status" className="text-caption text-muted-foreground">{t("pending")}</span> : null}
    </div>
  );
}
