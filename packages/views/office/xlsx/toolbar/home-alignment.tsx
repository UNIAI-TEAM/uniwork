"use client";

import { AlignCenter, AlignCenterHorizontal, AlignEndHorizontal, AlignLeft, AlignRight, AlignStartHorizontal, TextWrap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import type { RibbonItem } from "../../ribbon";
import { XLSX_HORIZONTAL_ALIGN, XLSX_TEXT_ROTATIONS, XLSX_VERTICAL_ALIGN, XLSX_WRAP_STRATEGY } from "./home-format";
import { xlsxMergeRibbonItem } from "./structure-merge";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_FIELD_BOX_CLASS, XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "./group-layout";

const HORIZONTAL_ALIGNMENTS = [
  { key: "left", value: XLSX_HORIZONTAL_ALIGN.left, Icon: AlignLeft },
  { key: "center", value: XLSX_HORIZONTAL_ALIGN.center, Icon: AlignCenter },
  { key: "right", value: XLSX_HORIZONTAL_ALIGN.right, Icon: AlignRight },
] as const;

const VERTICAL_ALIGNMENTS = [
  { key: "top", value: XLSX_VERTICAL_ALIGN.top, Icon: AlignStartHorizontal },
  { key: "middle", value: XLSX_VERTICAL_ALIGN.middle, Icon: AlignCenterHorizontal },
  { key: "bottom", value: XLSX_VERTICAL_ALIGN.bottom, Icon: AlignEndHorizontal },
] as const;

const ROTATION_WIDTH = 60;

function isBlocked({ readOnly = false, canFormat, commands }: XlsxToolbarGroupProps): boolean {
  return readOnly || !canFormat || !commands;
}

function wrapParams(wrap: boolean | undefined): { value: number } {
  return { value: wrap ? XLSX_WRAP_STRATEGY.overflow : XLSX_WRAP_STRATEGY.wrap };
}

function RotationSelect({ context }: { context: XlsxToolbarGroupProps }) {
  const { t } = useTranslation();
  const blocked = isBlocked(context);
  return (
    <div className={cn(XLSX_FIELD_BOX_CLASS, "w-14")}>
      <Select
        aria-label={t("office.xlsx.toolbar.groups.alignment.rotation")}
        triggerVariant="subtle"
        disabled={blocked}
        value={String(context.formatState?.textRotation ?? 0)}
        onValueChange={(value) => {
          if (blocked) return;
          fireCommand(context.commands, "sheet.command.set-text-rotation", { value: Number(value) });
        }}
        items={XLSX_TEXT_ROTATIONS.map((angle) => ({
          value: String(angle),
          label: t("office.xlsx.toolbar.groups.alignment.rotationAngle", { angle }),
        }))}
      />
    </div>
  );
}

/** Home > Alignment as typed ribbon items, in Excel's 2-row icon strip:
 *  row 1 top / middle / bottom, wrap text, text rotation; row 2 left / centre /
 *  right and the Merge & center split. Excel's indent buttons are left out:
 *  the renderer has no indent command (indent only exists as cell padding in
 *  the edit journal), and no command id is invented for it. */
export function xlsxAlignmentRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  const { commands, formatState } = context;
  const blocked = isBlocked(context);
  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    fireCommand(commands, id, params);
  };
  const vertical: RibbonItem[] = VERTICAL_ALIGNMENTS.map(({ key, value, Icon }) => ({
    kind: "toggle",
    id: `align-${key}`,
    labelKey: `office.xlsx.toolbar.groups.alignment.${key}`,
    icon: Icon,
    size: "icon",
    collapseAs: "icon",
    pressed: formatState?.verticalAlign === value,
    disabled: blocked,
    onExecute: () => run("sheet.command.set-vertical-text-align", { value }),
  }));
  const horizontal: RibbonItem[] = HORIZONTAL_ALIGNMENTS.map(({ key, value, Icon }, index) => ({
    kind: "toggle",
    id: `align-${key}`,
    labelKey: `office.xlsx.toolbar.groups.alignment.${key}`,
    icon: Icon,
    size: "icon",
    collapseAs: "icon",
    rowBreak: index === 0,
    pressed: formatState?.horizontalAlign === value,
    disabled: blocked,
    onExecute: () => run("sheet.command.set-horizontal-text-align", { value }),
  }));
  return [
    ...vertical,
    {
      kind: "toggle",
      id: "align-wrap",
      labelKey: "office.xlsx.toolbar.groups.alignment.wrap",
      icon: TextWrap,
      size: "icon",
      collapseAs: "icon",
      pressed: formatState?.wrap === true,
      disabled: blocked,
      onExecute: () => run("sheet.command.set-text-wrap", wrapParams(formatState?.wrap)),
    },
    {
      kind: "custom",
      id: "align-rotation",
      labelKey: "office.xlsx.toolbar.groups.alignment.rotation",
      size: "icon",
      collapseAs: "icon",
      width: ROTATION_WIDTH,
      disabled: blocked,
      render: () => <RotationSelect context={context} />,
    },
    ...horizontal,
    xlsxMergeRibbonItem(context),
  ];
}

/** Pre-ribbon group body, kept as the registry's single-item fallback. */
export function XlsxAlignmentGroup(props: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const { formatState } = props;
  const blocked = isBlocked(props);
  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    fireCommand(props.commands, id, params);
  };
  const button = (id: string, key: string, Icon: typeof TextWrap, pressed: boolean, params: unknown) => (
    <Button
      key={id + key}
      type="button"
      variant="toolbar"
      size="icon-sm"
      className={XLSX_ICON_BUTTON_CLASS}
      title={t(`office.xlsx.toolbar.groups.alignment.${key}`)}
      aria-label={t(`office.xlsx.toolbar.groups.alignment.${key}`)}
      aria-pressed={pressed}
      aria-disabled={blocked || undefined}
      onClick={() => run(id, params)}
    >
      <Icon aria-hidden />
    </Button>
  );

  return (
    <XlsxGroupBody>
    <XlsxGroupRows>
    <XlsxGroupRow>
      {VERTICAL_ALIGNMENTS.map(({ key, value, Icon }) =>
        button("sheet.command.set-vertical-text-align", key, Icon, formatState?.verticalAlign === value, { value }))}
      {button("sheet.command.set-text-wrap", "wrap", TextWrap, formatState?.wrap === true, wrapParams(formatState?.wrap))}
    </XlsxGroupRow>
    <XlsxGroupRow>
      {HORIZONTAL_ALIGNMENTS.map(({ key, value, Icon }) =>
        button("sheet.command.set-horizontal-text-align", key, Icon, formatState?.horizontalAlign === value, { value }))}
      <RotationSelect context={props} />
    </XlsxGroupRow>
    </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
