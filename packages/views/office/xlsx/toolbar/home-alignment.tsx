"use client";

import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, TextWrap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { XLSX_HORIZONTAL_ALIGN, XLSX_TEXT_ROTATIONS, XLSX_VERTICAL_ALIGN, XLSX_WRAP_STRATEGY } from "./home-format";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";

const HORIZONTAL_ALIGNMENTS = [
  { key: "left", value: XLSX_HORIZONTAL_ALIGN.left, Icon: AlignStartHorizontal },
  { key: "center", value: XLSX_HORIZONTAL_ALIGN.center, Icon: AlignCenterHorizontal },
  { key: "right", value: XLSX_HORIZONTAL_ALIGN.right, Icon: AlignEndHorizontal },
] as const;

const VERTICAL_ALIGNMENTS = [
  { key: "top", value: XLSX_VERTICAL_ALIGN.top, Icon: AlignStartVertical },
  { key: "middle", value: XLSX_VERTICAL_ALIGN.middle, Icon: AlignCenterVertical },
  { key: "bottom", value: XLSX_VERTICAL_ALIGN.bottom, Icon: AlignEndVertical },
] as const;

/** Home > alignment: horizontal and vertical alignment, wrap and rotation. */
export function XlsxAlignmentGroup({ readOnly = false, canFormat, commands, formatState }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !canFormat || !commands;
  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    fireCommand(commands, id, params);
  };

  return (
    <>
      {HORIZONTAL_ALIGNMENTS.map(({ key, value, Icon }) => (
        <Button
          key={key}
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t(`office.xlsx.toolbar.groups.alignment.${key}`)}
          aria-pressed={formatState?.horizontalAlign === value}
          aria-disabled={blocked || undefined}
          onClick={() => run("sheet.command.set-horizontal-text-align", { value })}
        >
          <Icon aria-hidden />
        </Button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      {VERTICAL_ALIGNMENTS.map(({ key, value, Icon }) => (
        <Button
          key={key}
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t(`office.xlsx.toolbar.groups.alignment.${key}`)}
          aria-pressed={formatState?.verticalAlign === value}
          aria-disabled={blocked || undefined}
          onClick={() => run("sheet.command.set-vertical-text-align", { value })}
        >
          <Icon aria-hidden />
        </Button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.toolbar.groups.alignment.wrap")}
        aria-pressed={formatState?.wrap === true}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-text-wrap", {
          value: formatState?.wrap ? XLSX_WRAP_STRATEGY.overflow : XLSX_WRAP_STRATEGY.wrap,
        })}
      >
        <TextWrap aria-hidden />
      </Button>
      <Select
        aria-label={t("office.xlsx.toolbar.groups.alignment.rotation")}
        triggerVariant="subtle"
        disabled={blocked}
        value={String(formatState?.textRotation ?? 0)}
        onValueChange={(value) => run("sheet.command.set-text-rotation", { value: Number(value) })}
        items={XLSX_TEXT_ROTATIONS.map((angle) => ({
          value: String(angle),
          label: t("office.xlsx.toolbar.groups.alignment.rotationAngle", { angle }),
        }))}
      />
    </>
  );
}
