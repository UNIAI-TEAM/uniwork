"use client";

import { MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { toolbarGroupLabelDomId } from "./tabs";
import type { XlsxToolbarGroupDefinition, XlsxToolbarGroupProps, XlsxToolbarTabId } from "./types";
import { useToolbarOverflow } from "./use-toolbar-overflow";

function GroupBody({
  group,
  context,
  labelId,
  className,
}: {
  group: XlsxToolbarGroupDefinition;
  context: XlsxToolbarGroupProps;
  labelId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const Group = group.Component;
  return (
    <div role="group" aria-labelledby={labelId} data-xlsx-toolbar-group={group.id} className={cn("flex shrink-0 flex-col items-center gap-0.5", className)}>
      <div className="flex items-center gap-0.5">
        <Group {...context} />
      </div>
      <span id={labelId} className="text-caption leading-none text-muted-foreground">
        {t(group.labelKey)}
      </span>
    </div>
  );
}

/** One tab's command groups. Groups render in ascending `order`; whatever does
 *  not fit the measured strip collapses into the overflow panel, highest order
 *  first. An empty tab keeps an honest empty state — no placeholder commands. */
export function XlsxToolbarGroupStrip({ tab, groups, context }: { tab: XlsxToolbarTabId; groups: readonly XlsxToolbarGroupDefinition[]; context: XlsxToolbarGroupProps }) {
  const { t } = useTranslation();
  const ordered = useMemo(() => {
    const available = groups.filter((group) => group.isAvailable?.(context) ?? true);
    return available.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }, [groups, context]);
  const { containerRef, hiddenFrom } = useToolbarOverflow(ordered.map((group) => group.id));
  const collapsed = ordered.slice(hiddenFrom);

  if (ordered.length === 0) {
    return (
      <p className="min-w-0 flex-1 truncate px-2 text-caption text-muted-foreground" data-testid={`xlsx-toolbar-empty-${tab}`}>
        {t("office.xlsx.toolbar.emptyTab")}
      </p>
    );
  }

  return (
    <>
      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-testid={`xlsx-toolbar-groups-${tab}`}>
        {ordered.slice(0, hiddenFrom).map((group) => (
          <GroupBody key={group.id} group={group} context={context} labelId={toolbarGroupLabelDomId(tab, group.id)} className="border-r border-border/60 pr-1" />
        ))}
      </div>
      {collapsed.length > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="toolbar"
                size="icon-sm"
                className="shrink-0"
                data-testid={`xlsx-toolbar-overflow-${tab}`}
                aria-label={t("office.xlsx.toolbar.overflow")}
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </PopoverTrigger>
          <PopoverContent
            role="dialog"
            aria-label={t("office.xlsx.toolbar.overflow")}
            align="start"
            data-testid="xlsx-toolbar-overflow-panel"
            className="max-h-[60vh] w-auto min-w-48 max-w-72 flex-col items-stretch gap-2 overflow-y-auto"
          >
            {collapsed.map((group) => (
              <GroupBody
                key={group.id}
                group={group}
                context={context}
                labelId={toolbarGroupLabelDomId(tab, group.id, "-overflow")}
                className="items-start border-b border-border/60 pb-1.5 last:border-b-0 last:pb-0"
              />
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}
