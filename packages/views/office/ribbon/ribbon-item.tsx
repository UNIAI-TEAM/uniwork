"use client";

import type { ReactElement, ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Select } from "@uniwork/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { galleryVisible } from "./layout";
import type {
  RibbonComboItem,
  RibbonGalleryItem,
  RibbonGroupStage,
  RibbonIcon,
  RibbonItem,
  RibbonMenuEntry,
  RibbonSize,
} from "./types";

/** Marks portalled ribbon popups so the peek overlay ignores presses in them. */
export const RIBBON_PORTAL_ATTR = { "data-ribbon-portal": "" } as const;

const SIZE_CLASS: Record<RibbonSize, string> = {
  large:
    "h-16 min-w-13 flex-col justify-start gap-0.5 px-1.5 py-1 text-caption font-normal whitespace-normal [&_svg:not([class*='size-'])]:size-6",
  small: "h-[22px] justify-start gap-1.5 px-1.5 text-caption font-normal",
  icon: "size-7 p-0",
};

const PRESSED_CLASS = "aria-pressed:bg-surface-selected aria-pressed:text-surface-selected-foreground";

function useItemText(item: RibbonItem) {
  const { t } = useTranslation();
  const label = t(item.labelKey);
  const tip = t(item.tooltipKey ?? item.labelKey);
  const tooltip = item.shortcut ? t("office.ribbon.withShortcut", { label: tip, shortcut: item.shortcut }) : tip;
  return { t, label, tooltip };
}

function ItemFace({ icon: Icon, label, size }: { icon?: RibbonIcon; label: string; size: RibbonSize }) {
  if (size === "icon") return Icon ? <Icon aria-hidden /> : <span className="text-caption">{label}</span>;
  return (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      <span
        title={size === "large" ? label : undefined}
        className={size === "large" ? "shrink-0 max-w-20 truncate text-center leading-tight" : "truncate"}
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

type MenuEntry = Omit<RibbonMenuEntry, "labelKey"> & { label: string };

function MenuEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return (
    <DropdownMenuContent className="min-w-44" {...RIBBON_PORTAL_ATTR}>
      {entries.map(({ id, label, icon: Icon, disabled, checked, onSelect }) => (
        <DropdownMenuItem key={id} disabled={disabled} onClick={onSelect} data-ribbon-menu-entry={id}>
          {Icon ? <Icon aria-hidden /> : null}
          <span className="flex-1">{label}</span>
          {checked ? <Check aria-hidden className="size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

function ComboControl({ item, label }: { item: RibbonComboItem; label: string }) {
  const { t } = useTranslation();
  const items = item.options.map((option) => ({
    value: option.value,
    label: option.labelKey ? t(option.labelKey) : (option.label ?? option.value),
  }));
  return (
    <div className="h-[22px] shrink-0 pointer-coarse:h-11 [&_[data-slot=select-trigger]]:h-full" style={{ width: item.width ?? 112 }} data-ribbon-item={item.id}>
      <Select
        aria-label={label}
        triggerVariant="subtle"
        value={item.value}
        disabled={item.disabled}
        items={items}
        onValueChange={(value) => {
          if (typeof value === "string") item.onChange(value);
        }}
      />
    </div>
  );
}

function GalleryControl({ item, stage, inPanel }: { item: RibbonGalleryItem; stage: RibbonGroupStage; inPanel: boolean }) {
  const { t, label } = useItemText(item);
  const visible = inPanel ? item.options : item.options.slice(0, galleryVisible(item, stage));
  const hidden = item.options.length > visible.length;
  const optionLabel = (option: RibbonGalleryItem["options"][number]) =>
    option.labelKey ? t(option.labelKey) : (option.label ?? option.id);
  return (
    <div className={cn("flex items-stretch gap-0.5", inPanel ? "min-w-0 flex-wrap" : "h-full shrink-0")} data-ribbon-item={item.id} data-ribbon-gallery-visible={visible.length}>
      {visible.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="ghost"
          aria-label={optionLabel(option)}
          aria-pressed={item.selectedId === option.id}
          aria-disabled={item.disabled || undefined}
          className={cn(
            "h-14 min-h-14 flex-col items-start justify-end overflow-hidden border border-border bg-background px-1.5 py-1 text-caption font-normal",
            PRESSED_CLASS,
          )}
          style={{ width: item.cardWidth ?? 76 }}
          onClick={() => item.onSelect(option.id)}
        >
          <span className="w-full truncate text-left">{option.preview ?? optionLabel(option)}</span>
        </Button>
      ))}
      {hidden ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                className="h-full w-5 min-w-0 px-0"
                aria-label={t("office.ribbon.moreCards", { label })}
                title={t("office.ribbon.moreCards", { label })}
              />
            }
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <MenuEntries
            entries={item.options.map((option) => ({
              id: option.id,
              label: optionLabel(option),
              checked: item.selectedId === option.id,
              onSelect: () => item.onSelect(option.id),
            }))}
          />
        </DropdownMenu>
      ) : null}
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

  const showTooltip = size === "icon" || Boolean(item.tooltipKey) || Boolean(item.shortcut);
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
      aria-label={size === "icon" ? label : undefined}
      aria-pressed={pressed}
      className={cn(
        SIZE_CLASS[size],
        PRESSED_CLASS,
        item.kind === "split" && (size === "large" ? "h-12 rounded-b-none" : "rounded-r-none"),
      )}
      onClick={item.onExecute}
    >
      <ItemFace icon={item.icon} label={label} size={size} />
    </Button>
  );
  const withTip = <WithTooltip show={showTooltip} text={tooltip}>{primary}</WithTooltip>;
  if (item.kind !== "split") return withTip;

  return (
    <div className={cn("flex shrink-0", size === "large" ? "h-16 flex-col" : "items-stretch")} role="group" aria-label={label}>
      {withTip}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label={t("office.ribbon.options", { label })}
              title={t("office.ribbon.options", { label })}
              aria-disabled={item.disabled || undefined}
              data-ribbon-split-menu={item.id}
              className={size === "large" ? "h-4 w-full min-w-0 px-0" : "h-auto w-4 min-w-0 rounded-l-none px-0"}
            />
          }
        >
          <ChevronDown aria-hidden className="size-3" />
        </DropdownMenuTrigger>
        <MenuEntries entries={item.menu.map(({ labelKey, ...entry }) => ({ ...entry, label: t(labelKey) }))} />
      </DropdownMenu>
    </div>
  );
}
