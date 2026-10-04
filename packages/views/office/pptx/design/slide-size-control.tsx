"use client";

/**
 * Slide size control (Design tab, `set_slide_size`). Two presets (16:9 and 4:3)
 * plus a readout of the deck's actual size, including the custom case the
 * presets cannot name.
 *
 * The edit is EMU only - this area has no px geometry, so the control never
 * scales anything; it passes `cxEmu`/`cyEmu` straight through.
 *
 * Keyboard: the presets are one roving group; arrows wrap, Home/End jump.
 */
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import {
  PPTX_DESIGN_SLIDE_SIZES,
  emuToInches,
  matchSlideSizePreset,
  nextRovingIndex,
  rovingEntryIndex,
} from "./design-model";

export interface PptxSlideSizeControlProps {
  /** The deck's current EMU size, when known. */
  size?: { cx: number; cy: number } | null;
  busy?: boolean;
  disabled?: boolean;
  onSetSlideSize: (cxEmu: number, cyEmu: number) => void;
  className?: string;
}

export function PptxSlideSizeControl({
  size = null,
  busy = false,
  disabled = false,
  onSetSlideSize,
  className,
}: PptxSlideSizeControlProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  // The model stores each preset's FULL i18n key (`office.pptx.design.size.*`),
  // so its lookup must run against the root, not the panel prefix - a prefixed
  // call would double the namespace and leave the key untranslated.
  const { t: tRoot } = useTranslation();
  const activeId = matchSlideSizePreset(size);
  const activeIndex = PPTX_DESIGN_SLIDE_SIZES.findIndex((preset) => preset.id === activeId);
  const [focusIndex, setFocusIndex] = useState(() => rovingEntryIndex(activeIndex, PPTX_DESIGN_SLIDE_SIZES.length));
  const blocked = disabled || busy;
  const readout = size
    ? activeId
      ? t(`design.size.${activeId}`)
      : t("design.size.custom", { width: emuToInches(size.cx), height: emuToInches(size.cy) })
    : null;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(index, PPTX_DESIGN_SLIDE_SIZES.length, event.key);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-size-preset]")[next]?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-caption font-medium text-muted-foreground">{t("design.slide_size_label")}</span>
      <div
        role="radiogroup"
        aria-label={t("design.size_group_label")}
        aria-busy={busy || undefined}
        data-pptx-slide-size
        className="flex flex-wrap gap-2"
      >
        {PPTX_DESIGN_SLIDE_SIZES.map((preset, index) => {
          const active = preset.id === activeId;
          const label = tRoot(preset.labelKey);
          const dimensions = `${emuToInches(preset.cxEmu)} x ${emuToInches(preset.cyEmu)} in`;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              disabled={blocked}
              tabIndex={index === focusIndex ? 0 : -1}
              data-size-preset={preset.id}
              data-active={active}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => move(event, index)}
              onClick={() => !blocked && onSetSlideSize(preset.cxEmu, preset.cyEmu)}
              className={cn(
                "flex min-w-24 flex-col items-start gap-0.5 rounded-md border border-border bg-background px-2 py-1 text-left",
                active && "border-primary ring-1 ring-primary",
                blocked && "opacity-60",
              )}
            >
              <span className="text-caption">{label}</span>
              <span aria-hidden="true" className="text-caption tabular-nums text-muted-foreground">
                {dimensions}
              </span>
            </button>
          );
        })}
      </div>
      {readout ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-design-size-readout">
          {readout}
        </p>
      ) : null}
    </div>
  );
}