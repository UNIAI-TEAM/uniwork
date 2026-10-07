"use client";

// UNI-940 X02: the Insert-tab picker the Chart and Shapes commands share - a
// LARGE ribbon button that opens a popover of typed entries (the home-cells
// menu pattern). A blocked menu keeps its trigger focusable with
// aria-disabled and never opens; `blockedReason` becomes its tooltip.
import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { XLSX_LARGE_BUTTON_CLASS, XlsxLargeLabel } from "../toolbar/group-layout";

interface XlsxVisualMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
}

export function XlsxVisualMenu({
  id,
  labelKey,
  icon: Icon,
  blocked,
  blockedReason,
  entries,
}: {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  blocked: boolean;
  blockedReason?: string | undefined;
  entries: readonly XlsxVisualMenuEntry[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t(labelKey);
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(blocked ? false : next)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={XLSX_LARGE_BUTTON_CLASS}
            aria-label={label}
            title={blocked ? blockedReason ?? label : label}
            aria-disabled={blocked || undefined}
            data-testid={`xlsx-visuals-${id}-trigger`}
          />
        }
      >
        <Icon aria-hidden />
        <XlsxLargeLabel>{label}</XlsxLargeLabel>
        <ChevronDown aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={label}
        align="start"
        data-ribbon-portal=""
        data-testid={`xlsx-visuals-${id}-menu`}
        className="w-auto max-w-72 flex-col items-stretch gap-1 p-2"
      >
        {entries.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            variant="toolbar"
            size="sm"
            className="justify-start"
            data-testid={`xlsx-visuals-${id}-${entry.id}`}
            onClick={() => {
              setOpen(false);
              entry.onSelect();
            }}
          >
            <entry.icon aria-hidden />
            {entry.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
