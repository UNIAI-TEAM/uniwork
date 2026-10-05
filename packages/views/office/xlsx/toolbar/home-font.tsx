"use client";

import { AArrowDown, AArrowUp, Baseline, Bold, Italic, Minus, PaintBucket, Plus, Strikethrough, Underline, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Select } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import type { RibbonItem } from "../../ribbon";
import { clampFontSize, stepFontSize, XLSX_DEFAULT_FONT_FAMILY, XLSX_DEFAULT_FONT_SIZE, XLSX_FONT_FAMILIES, XLSX_PALETTE_COLORS } from "./home-format";
import { xlsxBordersRibbonItem } from "./home-borders";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_FIELD_BOX_CLASS, XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "./group-layout";

const SIZE_DECREASE = -1;
const SIZE_INCREASE = 1;
const FAMILY_WIDTH = 140;
// F5 (UNI-926 FRAME): the size box never renders below 56 px (w-14 = 3.5rem).
const SIZE_FIELD_WIDTH = 56;
const COLOR_BUTTON_WIDTH = 26;

function isBlocked({ readOnly = false, canFormat, commands }: XlsxToolbarGroupProps): boolean {
  return readOnly || !canFormat || !commands;
}

function runner(context: XlsxToolbarGroupProps): (id: string, params?: unknown) => void {
  const blocked = isBlocked(context);
  return (id, params) => {
    if (blocked) return;
    fireCommand(context.commands, id, params);
  };
}

/** The shared swatch grid: workbook colour data, the active swatch mirrored
 *  with `aria-pressed`; chrome stays on semantic tokens. */
function ColorPicker({
  label,
  currentColor,
  onPick,
  resetLabel,
  onReset,
}: {
  label: string;
  currentColor: string | null;
  onPick: (color: string) => void;
  resetLabel: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div role="group" aria-label={label} className="grid grid-cols-5 gap-1">
        {XLSX_PALETTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("office.xlsx.toolbar.groups.font.colorValue", { color })}
            aria-pressed={color.toLowerCase() === currentColor?.toLowerCase()}
            className="size-5 rounded-sm border border-border"
            style={{ backgroundColor: color }}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
      <Button type="button" variant="toolbar" size="sm" onClick={onReset}>
        {resetLabel}
      </Button>
    </>
  );
}

function FontFamilySelect({ context }: { context: XlsxToolbarGroupProps }) {
  const { t } = useTranslation();
  const run = runner(context);
  return (
    <div className={cn(XLSX_FIELD_BOX_CLASS, "w-36 min-w-35")}>
      <Select
        aria-label={t("office.xlsx.toolbar.groups.font.family")}
        triggerVariant="subtle"
        disabled={isBlocked(context)}
        value={context.formatState?.fontFamily ?? XLSX_DEFAULT_FONT_FAMILY}
        onValueChange={(value) => run("sheet.command.set-font-family", { value })}
        items={XLSX_FONT_FAMILIES.map((family) => ({ value: family, label: family }))}
      />
    </div>
  );
}

/** Excel's editable size box: the draft commits clamped on Enter or blur. */
function FontSizeField({ context }: { context: XlsxToolbarGroupProps }) {
  const { t } = useTranslation();
  const run = runner(context);
  const size = context.formatState?.fontSize ?? null;
  const [sizeDraft, setSizeDraft] = useState(String(size ?? XLSX_DEFAULT_FONT_SIZE));

  useEffect(() => {
    setSizeDraft(String(size ?? XLSX_DEFAULT_FONT_SIZE));
  }, [size]);

  const commitSize = () => {
    if (!/^\d+$/.test(sizeDraft)) {
      setSizeDraft(String(size ?? XLSX_DEFAULT_FONT_SIZE));
      return;
    }
    const next = clampFontSize(Number.parseInt(sizeDraft, 10));
    setSizeDraft(String(next));
    run("sheet.command.set-font-size", { value: next });
  };

  return (
    <Input
      className="h-6 w-14 min-w-14 rounded-sm border-input px-1 text-center text-caption"
      inputMode="numeric"
      aria-label={t("office.xlsx.toolbar.groups.font.size")}
      disabled={isBlocked(context)}
      value={sizeDraft}
      onChange={(event) => setSizeDraft(event.target.value)}
      onBlur={commitSize}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitSize();
      }}
    />
  );
}

const COLOR_KINDS = {
  text: {
    Icon: Baseline,
    labelKey: "office.xlsx.toolbar.groups.font.textColor",
    resetKey: "office.xlsx.toolbar.groups.font.textColorAutomatic",
    setCommand: "sheet.command.set-text-color",
    resetCommand: "sheet.command.reset-text-color",
  },
  fill: {
    Icon: PaintBucket,
    labelKey: "office.xlsx.toolbar.groups.font.fillColor",
    resetKey: "office.xlsx.toolbar.groups.font.fillColorNone",
    setCommand: "sheet.command.set-background-color",
    resetCommand: "sheet.command.reset-background-color",
  },
} as const;

/** Icon button with the live colour bar under it, opening the swatch popover. */
function ColorButton({ context, kind }: { context: XlsxToolbarGroupProps; kind: keyof typeof COLOR_KINDS }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const blocked = isBlocked(context);
  const run = runner(context);
  const { Icon, labelKey, resetKey, setCommand, resetCommand } = COLOR_KINDS[kind];
  const current = (kind === "text" ? context.formatState?.textColor : context.formatState?.fillColor) ?? null;
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(blocked ? false : next)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            aria-disabled={blocked || undefined}
          />
        }
      >
        <span className="flex flex-col items-center gap-px">
          <Icon aria-hidden />
          {current ? <span aria-hidden className="h-0.5 w-3.5 rounded-sm" style={{ backgroundColor: current }} /> : null}
        </span>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label={t(labelKey)} align="start" className="w-auto max-w-56 flex-col gap-2 p-2">
        <ColorPicker
          label={t(labelKey)}
          currentColor={current}
          onPick={(color) => run(setCommand, { value: color })}
          resetLabel={t(resetKey)}
          onReset={() => run(resetCommand)}
        />
      </PopoverContent>
    </Popover>
  );
}

const TOGGLES = [
  { key: "bold", id: "sheet.command.set-bold", Icon: Bold, shortcut: "Ctrl+B" },
  { key: "italic", id: "sheet.command.set-italic", Icon: Italic, shortcut: "Ctrl+I" },
  { key: "underline", id: "sheet.command.set-underline", Icon: Underline, shortcut: "Ctrl+U" },
  { key: "strike", id: "sheet.command.set-stroke", Icon: Strikethrough, shortcut: undefined },
] as const;

/** Home > Font as typed ribbon items, packed into Excel's two icon rows:
 *  row 1 family, size box, A+ / A-; row 2 B I U S, Borders split, fill colour,
 *  font colour. Every command id and param is the one the pre-ribbon group
 *  fired; a blocked group (read-only, !canFormat, no port) is aria-disabled. */
export function xlsxFontRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  const blocked = isBlocked(context);
  const run = runner(context);
  const { formatState } = context;
  const size = formatState?.fontSize ?? null;
  const toggles: RibbonItem[] = TOGGLES.map(({ key, id, Icon, shortcut }, index) => ({
    kind: "toggle",
    id: `font-${key}`,
    labelKey: `office.xlsx.toolbar.groups.font.${key}`,
    icon: Icon,
    size: "icon",
    collapseAs: "icon",
    rowBreak: index === 0,
    shortcut,
    pressed: formatState?.[key] === true,
    disabled: blocked,
    onExecute: () => run(id),
  }));
  return [
    {
      kind: "custom",
      id: "font-family",
      labelKey: "office.xlsx.toolbar.groups.font.family",
      size: "icon",
      collapseAs: "icon",
      width: FAMILY_WIDTH,
      disabled: blocked,
      render: () => <FontFamilySelect context={context} />,
    },
    {
      kind: "custom",
      id: "font-size",
      labelKey: "office.xlsx.toolbar.groups.font.size",
      size: "icon",
      collapseAs: "icon",
      width: SIZE_FIELD_WIDTH,
      disabled: blocked,
      render: () => <FontSizeField context={context} />,
    },
    {
      kind: "button",
      id: "font-size-increase",
      labelKey: "office.xlsx.toolbar.groups.font.sizeIncrease",
      icon: AArrowUp,
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: () => run("sheet.command.set-font-size", { value: stepFontSize(size, SIZE_INCREASE) }),
    },
    {
      kind: "button",
      id: "font-size-decrease",
      labelKey: "office.xlsx.toolbar.groups.font.sizeDecrease",
      icon: AArrowDown,
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: () => run("sheet.command.set-font-size", { value: stepFontSize(size, SIZE_DECREASE) }),
    },
    ...toggles,
    xlsxBordersRibbonItem(context),
    {
      kind: "custom",
      id: "font-fill-color",
      labelKey: "office.xlsx.toolbar.groups.font.fillColor",
      size: "icon",
      collapseAs: "icon",
      width: COLOR_BUTTON_WIDTH,
      disabled: blocked,
      render: () => <ColorButton context={context} kind="fill" />,
    },
    {
      kind: "custom",
      id: "font-text-color",
      labelKey: "office.xlsx.toolbar.groups.font.textColor",
      size: "icon",
      collapseAs: "icon",
      width: COLOR_BUTTON_WIDTH,
      disabled: blocked,
      render: () => <ColorButton context={context} kind="text" />,
    },
  ];
}

/** Pre-ribbon group body, kept as the registry's single-item fallback. */
export function XlsxFontGroup(props: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = isBlocked(props);
  const run = runner(props);
  const { formatState } = props;
  const size = formatState?.fontSize ?? null;
  const toggle = (id: string, active: boolean, label: string, Icon: LucideIcon) => (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      className={XLSX_ICON_BUTTON_CLASS}
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-disabled={blocked || undefined}
      onClick={() => run(id)}
    >
      <Icon aria-hidden />
    </Button>
  );
  const step = (delta: number, key: "sizeDecrease" | "sizeIncrease", Icon: LucideIcon) => (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      className={XLSX_ICON_BUTTON_CLASS}
      aria-label={t(`office.xlsx.toolbar.groups.font.${key}`)}
      title={t(`office.xlsx.toolbar.groups.font.${key}`)}
      aria-disabled={blocked || undefined}
      onClick={() => run("sheet.command.set-font-size", { value: stepFontSize(size, delta) })}
    >
      <Icon aria-hidden />
    </Button>
  );

  return (
    <XlsxGroupBody>
    <XlsxGroupRows>
    <XlsxGroupRow>
      <FontFamilySelect context={props} />
      {step(SIZE_DECREASE, "sizeDecrease", Minus)}
      <FontSizeField context={props} />
      {step(SIZE_INCREASE, "sizeIncrease", Plus)}
    </XlsxGroupRow>
    <XlsxGroupRow>
      {TOGGLES.map(({ key, id, Icon }) => (
        <span key={key} className="contents">
          {toggle(id, formatState?.[key] === true, t(`office.xlsx.toolbar.groups.font.${key}`), Icon)}
        </span>
      ))}
      <ColorButton context={props} kind="text" />
      <ColorButton context={props} kind="fill" />
    </XlsxGroupRow>
    </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
