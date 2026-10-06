"use client";

import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { galleryVisible } from "./layout";
import { MenuEntries } from "./ribbon-menu";
import type { RibbonGalleryItem, RibbonGalleryOption, RibbonGroupStage } from "./types";

/** Literal specimen text of a style card (not UI copy). */
const DEFAULT_SAMPLE = "AaBbCcDd";

const CARD_CLASS =
  "min-h-14 flex-col items-start justify-between gap-0 overflow-hidden rounded-none border-0 bg-transparent px-1.5 py-1 text-caption font-normal hover:bg-surface-hover aria-pressed:bg-surface-selected aria-pressed:text-surface-selected-foreground aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-ring aria-pressed:hover:bg-surface-selected";

/** Office in-ribbon gallery: one bordered box holding the visible cards side by
 * side (specimen on top, name underneath) and a narrow "more" column at its
 * right that lists every card. Inside a panel the cards wrap instead. */
export function GalleryControl({ item, stage, inPanel }: { item: RibbonGalleryItem; stage: RibbonGroupStage; inPanel: boolean }) {
  const { t } = useTranslation();
  const label = t(item.labelKey);
  const visible = inPanel ? item.options : item.options.slice(0, galleryVisible(item, stage));
  const hidden = item.options.length > visible.length;
  const sample = item.sample ?? DEFAULT_SAMPLE;
  const optionLabel = (option: RibbonGalleryOption) => (option.labelKey ? t(option.labelKey) : (option.label ?? option.id));
  return (
    <div
      className={cn(
        "flex rounded-md border border-border bg-background",
        inPanel ? "min-w-0 flex-wrap" : "h-full max-h-18 shrink-0 items-stretch overflow-hidden",
      )}
      data-ribbon-item={item.id}
      data-ribbon-gallery-visible={visible.length}
    >
      {visible.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="ghost"
          aria-label={optionLabel(option)}
          aria-pressed={item.selectedId === option.id}
          aria-disabled={item.disabled || undefined}
          className={cn(inPanel ? "h-14" : "h-full", CARD_CLASS)}
          style={{ width: item.cardWidth ?? 76 }}
          onClick={() => item.onSelect(option.id)}
        >
          <span className="w-full truncate text-left text-body-lg leading-tight">{option.preview ?? sample}</span>
          <span className="w-full truncate text-left text-caption text-muted-foreground group-aria-pressed/button:text-surface-selected-foreground">{optionLabel(option)}</span>
        </Button>
      ))}
      {hidden ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                className="h-full w-5 min-w-0 rounded-none border-0 border-l border-border px-0"
                aria-label={t("office.ribbon.moreCards", { label })}
                title={t("office.ribbon.moreCards", { label })}
                data-ribbon-gallery-more={item.id}
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
