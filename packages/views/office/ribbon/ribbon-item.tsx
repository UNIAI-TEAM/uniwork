"use client";

import type { ReactElement, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { COMBO_DEFAULT, COMBO_MIN } from "./layout";
import { GalleryControl } from "./ribbon-gallery";
import { MenuEntries } from "./ribbon-menu";
import type { RibbonComboItem, RibbonGroupStage, RibbonIcon, RibbonItem, RibbonSize } from "./types";


// `pointer-coarse:min-h-11 / min-w-11` come from the Button primitive, so the
// 24px fine-pointer sizes below still meet the 44px coarse target.
const SIZE_CLASS: Record<RibbonSize, string> = {
  large:
    "h-auto min-w-12 flex-1 flex-col justify-start gap-0.5 self-stretch px-1.5 py-0.5 text-caption font-normal whitespace-normal [&_svg:not([class*='size-'])]:size-7",
  small: "h-6 justify-start gap-1.5 px-1.5 text-caption font-normal",
  icon: "size-6 p-0 [&_svg:not([class*='size-'])]:size-4",
};

const PRESSED_CLASS = "aria-pressed:bg-surface-selected aria-pressed:text-surface-selected-foreground";
/** Split parts read as one control: a shared outline appears on hover. */
const UNIT_CLASS = "rounded-sm hover:ring-1 hover:ring-inset hover:ring-border";

const TRIGGER_CLASS =
  "[&_[data-slot=select-trigger]]:h-full [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:py-0 [&_[data-slot=select-trigger]]:pr-1 [&_[data-slot=select-trigger]]:pl-1.5 [&_[data-slot=select-trigger]]:text-caption";

function useItemText(item: RibbonItem) {
  const { t } = useTranslation();
  const label = t(item.labelKey);
  const tip = t(item.tooltipKey ?? item.labelKey);
  const tooltip = item.shortcut ? t("office.ribbon.withShortcut", { label: tip, shortcut: item.shortcut }) : tip;
  return { t, label, tooltip };
}

function ItemFace({ icon: Icon, label, size, iconOnly }: { icon?: RibbonIcon; label: string; size: RibbonSize; iconOnly?: boolean }) {
  if (size === "icon" || iconOnly) return Icon ? <Icon aria-hidden /> : <span className="text-caption">{label}</span>;
  return (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      <span
        title={size === "large" ? label : undefined}
        className={size === "large" ? "line-clamp-2 max-w-20 shrink-0 text-center leading-tight pb-px" : "truncate"}
      >
        {label}
      </span>
    </>
  );
}

/** Icon-only items and items with an explicit tooltip or shortcut get the
 * packages/ui tooltip; a visible label alone needs none. */
function WithTooltip({ show, text, children }: { show: boolean; text: string; children: ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">{text}</TooltipContent>
    </Tooltip>
  );
}

function ComboControl({ item, label }: { item: RibbonComboItem; label: string }) {
  const { t } = useTranslation();
  const items = item.options.map((option) => ({
    value: option.value,
    label: option.labelKey ? t(option.labelKey) : (option.label ?? option.value),
  }));
  return (
    <div
      className={cn("h-6 shrink-0 pointer-coarse:h-11", TRIGGER_CLASS)}
      style={{ width: Math.max(COMBO_MIN, item.width ?? COMBO_DEFAULT) }}
      data-ribbon-item={item.id}
    >
      <Select
        aria-label={label}
        triggerVariant="subtle"
        value={item.value}
        disabled={item.disabled}
        items={items}
        onValueChange={(value) => {
          if (typeof value === "string") item.onChange(value);
        }}
      >
        {item.placeholderKey ? (
          <>
            <SelectTrigger aria-label={label} variant="subtle" className="w-full">
              <SelectValue placeholder={t(item.placeholderKey)} />
            </SelectTrigger>
            <SelectContent>
              {items.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </>
        ) : undefined}
      </Select>
    </div>
  );
}

export interface RibbonItemViewProps {
  item: RibbonItem;
  size: RibbonSize;
  stage: RibbonGroupStage;
  inPanel: boolean;
}

/** One ribbon command at its effective size. Disabled commands use
 * aria-disabled so they stay reachable by keyboard (UI rules). */
export function RibbonItemView({ item, size, stage, inPanel }: RibbonItemViewProps): ReactNode {
  const { t, label, tooltip } = useItemText(item);
  if (item.kind === "combo") return <ComboControl item={item} label={label} />;
  if (item.kind === "gallery") return <GalleryControl item={item} stage={stage} inPanel={inPanel} />;
  if (item.kind === "custom") {
    return (
      <div className="flex shrink-0 items-center" data-ribbon-item={item.id} data-ribbon-size={size}>
        {item.render({ size, inPanel })}
      </div>
    );
  }

  const bigSplit = item.kind === "split" && size === "large";
  const showTooltip = size === "icon" || bigSplit || Boolean(item.tooltipKey) || Boolean(item.shortcut);
  const common = {
    type: "button" as const,
    variant: "ghost" as const,
    "aria-disabled": item.disabled || undefined,
    "data-ribbon-item": item.id,
    "data-ribbon-size": size,
  };

  if (item.kind === "dropdown") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              {...common}
              aria-label={size === "icon" ? label : undefined}
              title={tooltip}
              className={cn(SIZE_CLASS[size], size === "icon" && "w-auto gap-0 px-1")}
            />
          }
        >
          <ItemFace icon={item.icon} label={label} size={size} />
          <ChevronDown aria-hidden className="size-3" />
        </DropdownMenuTrigger>
        <MenuEntries entries={item.menu.map(({ labelKey, ...entry }) => ({ ...entry, label: t(labelKey) }))} />
      </DropdownMenu>
    );
  }

  const pressed = item.kind === "toggle" ? item.pressed : item.kind === "split" ? item.pressed : undefined;
  const primary = (
    <Button
      {...common}
      aria-label={size === "icon" || bigSplit ? label : undefined}
      aria-pressed={pressed}
      className={cn(SIZE_CLASS[size], PRESSED_CLASS, item.kind === "split" && (bigSplit ? "w-full rounded-b-none" : "rounded-r-none"))}
      onClick={item.onExecute}
    >
      <ItemFace icon={item.icon} label={label} size={size} iconOnly={bigSplit} />
    </Button>
  );
  const withTip = <WithTooltip show={showTooltip} text={tooltip}>{primary}</WithTooltip>;
  if (item.kind !== "split") return withTip;

  const optionsLabel = t("office.ribbon.options", { label });
  return (
    <div className={cn("flex shrink-0", UNIT_CLASS, bigSplit ? "flex-col self-stretch" : "items-stretch")} role="group" aria-label={label}>
      {withTip}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label={optionsLabel}
              title={optionsLabel}
              aria-disabled={item.disabled || undefined}
              data-ribbon-split-menu={item.id}
              className={
                bigSplit
                  ? "h-5 w-full min-w-0 gap-0.5 rounded-t-none px-1 text-caption font-normal"
                  : "h-auto w-3.5 min-w-0 rounded-l-none px-0"
              }
            />
          }
        >
          {bigSplit ? <span className="truncate">{label}</span> : null}
          <ChevronDown aria-hidden className="size-3" />
        </DropdownMenuTrigger>
        <MenuEntries entries={item.menu.map(({ labelKey, ...entry }) => ({ ...entry, label: t(labelKey) }))} />
      </DropdownMenu>
    </div>
  );
}
