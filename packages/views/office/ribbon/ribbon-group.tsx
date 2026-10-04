"use client";

import { ArrowDownRight, ChevronDown, LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { groupBlocks, itemSize, type RibbonBlock } from "./layout";
import { RIBBON_PORTAL_ATTR, RibbonItemView } from "./ribbon-item";
import type { RibbonGroup, RibbonGroupStage, RibbonItem } from "./types";

function blockKey(block: RibbonBlock): string {
  if (block.kind === "column") return `c:${block.items.map((item) => item.id).join(",")}`;
  if (block.kind === "strip") return `s:${block.rows.flat().map((item) => item.id).join(",")}`;
  return `${block.kind}:${block.item.id}`;
}

function sizeOf(item: RibbonItem, stage: RibbonGroupStage) {
  return item.kind === "combo" ? "icon" : itemSize(item, stage);
}

function Block({ block, stage, inPanel }: { block: RibbonBlock; stage: RibbonGroupStage; inPanel: boolean }) {
  switch (block.kind) {
    case "column":
      return (
        <div className="flex shrink-0 flex-col justify-start gap-0" data-ribbon-block="column">
          {block.items.map((item) => (
            <RibbonItemView key={item.id} item={item} size={sizeOf(item, stage)} stage={stage} inPanel={inPanel} />
          ))}
        </div>
      );
    case "strip":
      return (
        <div className="flex shrink-0 flex-col justify-start gap-0.5" data-ribbon-block="strip">
          {block.rows.map((row) => (
            <div key={row.map((item) => item.id).join(",")} className="flex items-center gap-0.5">
              {row.map((item) => (
                <RibbonItemView key={item.id} item={item} size={sizeOf(item, stage)} stage={stage} inPanel={inPanel} />
              ))}
            </div>
          ))}
        </div>
      );
    default:
      return <RibbonItemView item={block.item} size={sizeOf(block.item, stage)} stage={stage} inPanel={inPanel} />;
  }
}

/** A group's items laid out at a stage (no caption). */
function GroupItems({ group, stage, inPanel }: { group: RibbonGroup; stage: RibbonGroupStage; inPanel: boolean }) {
  return (
    <div className={cn("flex min-h-0 items-stretch gap-1", inPanel ? "flex-wrap" : "flex-1")}>
      {groupBlocks(group.items, stage).map((block) => (
        <Block key={blockKey(block)} block={block} stage={stage} inPanel={inPanel} />
      ))}
    </div>
  );
}

function Launcher({ group }: { group: RibbonGroup }) {
  const { t } = useTranslation();
  if (!group.launcher) return null;
  const label = t(group.launcher.labelKey);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-4 min-w-0 rounded-sm"
      aria-label={label}
      title={label}
      data-ribbon-launcher={group.id}
      onClick={group.launcher.onOpen}
    >
      <ArrowDownRight aria-hidden className="size-3" />
    </Button>
  );
}

/** Group content inside a dropdown panel: full sizes, caption on top. */
function GroupPanel({ group }: { group: RibbonGroup }) {
  const { t } = useTranslation();
  const caption = t(group.labelKey);
  return (
    <PopoverContent
      align="start"
      className="w-auto max-w-[calc(100vw-2rem)] gap-1.5 p-2"
      aria-label={t("office.ribbon.groupPanel", { label: caption })}
      {...RIBBON_PORTAL_ATTR}
    >
      <div role="group" aria-label={caption} data-ribbon-panel={group.id} className="flex flex-col gap-1.5">
        <GroupItems group={group} stage={0} inPanel />
        <div className="flex items-center justify-between gap-2 border-t border-border pt-1 text-caption text-muted-foreground">
          <span>{caption}</span>
          <Launcher group={group} />
        </div>
      </div>
    </PopoverContent>
  );
}

/** A group folded into one button that opens its panel: `large` in the
 * ribbon body (stage 3), `chip` in the simplified phone row. */
export function RibbonGroupButton({ group, variant }: { group: RibbonGroup; variant: "large" | "chip" }) {
  const { t } = useTranslation();
  const caption = t(group.labelKey);
  const Icon = group.icon ?? group.items.find((item) => item.icon)?.icon ?? LayoutGrid;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            data-ribbon-group-button={group.id}
            className={
              variant === "large"
                ? "h-full min-w-15 flex-col justify-center gap-0.5 px-1.5 py-0.5 text-caption font-normal whitespace-normal [&_svg:not([class*='size-'])]:size-6"
                : "h-9 shrink-0 gap-1.5 px-2.5 text-label font-normal"
            }
          />
        }
      >
        <Icon aria-hidden />
        <span title={caption} className={variant === "large" ? "shrink-0 truncate max-w-28 text-center leading-tight" : undefined}>{caption}</span>
        <ChevronDown aria-hidden className="size-3" />
      </PopoverTrigger>
      <GroupPanel group={group} />
    </Popover>
  );
}

export interface RibbonGroupViewProps {
  group: RibbonGroup;
  stage: RibbonGroupStage;
}

/** One labelled group of the ribbon body: role=group named by its caption,
 * caption + optional dialog launcher at the bottom. */
export function RibbonGroupView({ group, stage }: RibbonGroupViewProps) {
  const { t } = useTranslation();
  const caption = t(group.labelKey);
  return (
    <div
      role="group"
      aria-label={caption}
      data-ribbon-group={group.id}
      data-ribbon-stage={stage}
      className="flex h-full shrink-0 flex-col border-r border-border px-1.5 last:border-r-0"
    >
      {stage === 3 ? (
        // The folded button carries the caption itself (Word), so no caption row.
        <RibbonGroupButton group={group} variant="large" />
      ) : (
        <>
          <GroupItems group={group} stage={stage} inPanel={false} />
          <div className="flex h-4 shrink-0 items-center justify-center gap-1 text-caption leading-none text-muted-foreground">
            <span className="truncate">{caption}</span>
            <Launcher group={group} />
          </div>
        </>
      )}
    </div>
  );
}
