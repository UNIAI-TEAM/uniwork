"use client";

/**
 * A disabled ribbon combo that still explains itself (UNI-927 F4). The shared
 * ribbon renders a `combo` item as a hard-disabled Select with no tooltip, so
 * the reason a font control is unavailable never surfaced. The lane emits this
 * as a `custom` item instead: a focusable wrapper carries the accessible name,
 * the reason as its description and a tooltip, around the same disabled Select.
 */
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@uniwork/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { COMBO_DEFAULT, COMBO_MIN } from "../ribbon/layout";
import type { RibbonOption } from "../ribbon/types";

const TRIGGER_CLASS =
  "[&_[data-slot=select-trigger]]:h-full [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:py-0 [&_[data-slot=select-trigger]]:pr-1 [&_[data-slot=select-trigger]]:pl-1.5 [&_[data-slot=select-trigger]]:text-caption";

interface PptxDisabledComboProps {
  labelKey: string;
  /** i18next key of the reason this control is disabled. */
  reasonKey: string;
  width?: number;
  value: string | null;
  options: readonly RibbonOption[];
}

function pptxDisabledComboWidth(width?: number): number {
  return Math.max(COMBO_MIN, width ?? COMBO_DEFAULT);
}

export function PptxDisabledCombo({ labelKey, reasonKey, width, value, options }: PptxDisabledComboProps): ReactNode {
  const { t } = useTranslation();
  const reasonId = useId();
  const label = t(labelKey);
  const reason = t(reasonKey);
  const items = options.map((option) => ({
    value: option.value,
    label: option.labelKey ? t(option.labelKey) : (option.label ?? option.value),
  }));
  const wrapper = (
    <div
      role="group"
      // Focusable on purpose: a disabled control must stay reachable so its reason can be read.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-disabled="true"
      aria-label={label}
      aria-describedby={reasonId}
      className={cn("h-6 shrink-0 pointer-coarse:h-11", TRIGGER_CLASS)}
      style={{ width: pptxDisabledComboWidth(width) }}
    >
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
      <div className="pointer-events-none h-full w-full" aria-hidden="true">
        <Select aria-label={label} triggerVariant="subtle" value={value} disabled items={items} />
      </div>
    </div>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={wrapper} />
      <TooltipContent side="bottom">{reason}</TooltipContent>
    </Tooltip>
  );
}
