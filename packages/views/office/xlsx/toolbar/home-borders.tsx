"use client";

import { Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "./group-layout";

/** Pinned Univer BorderType / BorderStyleTypes values; a thin black stroke is
 *  the Excel default the presets apply. */
const BORDER_STYLE_THIN = 1;
const BORDER_COLOR = "#000000";
const BORDER_PRESETS = [
  { key: "all", type: "all" },
  { key: "outside", type: "outside" },
  { key: "none", type: "none" },
] as const;
const BORDER_EDGES = [
  { key: "edgeTop", type: "top" },
  { key: "edgeRight", type: "right" },
  { key: "edgeBottom", type: "bottom" },
  { key: "edgeLeft", type: "left" },
] as const;

/** Home > borders: presets plus the four individual edges. Border state is not
 *  mirrored (the composed border of a range has no single cheap control
 *  state); the buttons stay stateless. */
export function XlsxBordersGroup({ readOnly = false, canFormat, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !canFormat || !commands;
  const [open, setOpen] = useState(false);
  const run = (type: string) => {
    if (blocked) return;
    fireCommand(commands, "sheet.command.set-border-basic", {
      value: { type, style: BORDER_STYLE_THIN, color: BORDER_COLOR },
    });
  };

  return (
    <XlsxGroupBody>
    <XlsxGroupRows>
    <XlsxGroupRow>
    <Popover open={open} onOpenChange={(next) => setOpen(blocked ? false : next)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            title={t("office.xlsx.toolbar.groups.borders.label")}
            aria-label={t("office.xlsx.toolbar.groups.borders.label")}
            aria-disabled={blocked || undefined}
          />
        }
      >
        <Square aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={t("office.xlsx.toolbar.groups.borders.label")}
        align="start"
        className="w-auto max-w-56 flex-col items-stretch gap-1.5 p-2"
      >
        <div role="group" aria-label={t("office.xlsx.toolbar.groups.borders.presets")} className="flex flex-wrap gap-1">
          {BORDER_PRESETS.map(({ key, type }) => (
            <Button key={key} type="button" variant="toolbar" size="sm" onClick={() => run(type)}>
              {t(`office.xlsx.toolbar.groups.borders.${key}`)}
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label={t("office.xlsx.toolbar.groups.borders.edges")}
          className="flex flex-wrap gap-1 border-t border-border pt-1.5"
        >
          {BORDER_EDGES.map(({ key, type }) => (
            <Button key={key} type="button" variant="toolbar" size="sm" onClick={() => run(type)}>
              {t(`office.xlsx.toolbar.groups.borders.${key}`)}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
    </XlsxGroupRow>
    </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
