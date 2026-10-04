"use client";

import { Fragment, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Redo2, Save, Undo2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { HomeFindGroup } from "./groups/home-find";
import { partitionToolbarGroups } from "./overflow";
import type { AvailabilityAwareGroup } from "./groups/insert-header-footer";
import { DOCX_TOOLBAR_TABS } from "./tabs/tabs";
import { useRovingToolbar } from "./use-roving-toolbar";
import { useToolbarWidth } from "./use-toolbar-width";
import type { DocxToolbarGroup, DocxToolbarGroupContext, DocxToolbarProps, DocxToolbarTab } from "./types";

/** A group component may declare that its command area is absent for this
 * context (see groups/insert-header-footer.tsx); the shell then renders
 * nothing, so an unavailable group cannot leave an empty labelled box (F1
 * secondary effect). */
function ToolbarGroupView({ group, context, label }: { group: DocxToolbarGroup; context: DocxToolbarGroupContext; label: string }) {
  const Group = group.component as AvailabilityAwareGroup;
  if (Group.isAvailable && !Group.isAvailable(context)) return null;
  return (
    <div role="group" aria-label={label} data-toolbar-group={group.id} className="flex shrink-0 items-center gap-1">
      <Group {...context} />
    </div>
  );
}

/**
 * One tab's command strip (C7): exactly one row of fixed groups with
 * separators. The strip never wraps into a ragged second row - groups the
 * current width cannot hold move into the trailing ">>" overflow menu, and
 * whatever still overflows scrolls horizontally (C12 at 390 px).
 */
function ToolbarGroupStrip({ tab, context }: { tab: DocxToolbarTab; context: DocxToolbarGroupContext }) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const width = useToolbarWidth(stripRef);
  useRovingToolbar(stripRef);
  const { inline, collapsed } = partitionToolbarGroups(tab.groups, width);

  return (
    <div className="relative flex min-w-0 items-center">
      <div
        ref={stripRef}
        role="toolbar"
        aria-label={t("office.docx.toolbar.label")}
        data-testid="docx-toolbar-groups"
        className="flex min-h-11 min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto px-2 py-1"
      >
        {inline.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 ? <Separator orientation="vertical" className="mx-1 h-5 shrink-0" /> : null}
            <ToolbarGroupView group={group} context={context} label={t(group.labelKey)} />
          </Fragment>
        ))}
      </div>
      {collapsed.length > 0 ? (
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.toolbar.overflow")} data-testid="docx-toolbar-overflow" className="me-1 shrink-0" />}>
            <MoreHorizontal aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
            <div data-testid="docx-toolbar-overflow-content" className="flex flex-col gap-1">
              {collapsed.map((group, index) => (
                <Fragment key={group.id}>
                  {index > 0 ? <Separator className="my-1" /> : null}
                  <ToolbarGroupView group={group} context={context} label={t(group.labelKey)} />
                </Fragment>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * The tabbed DOCX toolbar shell (C6/C7/C10). It owns the ribbon tab row - the
 * quick-access undo/redo pair at the far left, the scrollable tab list, and
 * Find plus the host Save at the far right - and the single command row below.
 * No selection/position text lives in the ribbon; it moved to the status bar
 * (C10). Every command group plugs in through DOCX_TOOLBAR_TABS and the shared
 * context in ./types.ts.
 */
export function DocxToolbarShell(context: DocxToolbarProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DocxToolbarTab["id"]>("home");
  const { coordinator, readOnly = false, saving, dirty, canUndo, canRedo, onUndo, onRedo, onSave } = context;

  return (
    <div className="flex flex-col border-b border-border bg-muted/30" data-testid="docx-toolbar">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DocxToolbarTab["id"])} className="gap-0">
        {/* Row 2 (40 px): quick access | tabs | Find. */}
        <div className="flex h-10 min-w-0 flex-nowrap items-center gap-2 px-2">
          <div className="flex shrink-0 items-center gap-1" data-testid="docx-quick-access">
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.undo")} disabled={readOnly || saving || !canUndo} onClick={onUndo}>
              <Undo2 aria-hidden />
            </Button>
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.redo")} disabled={readOnly || saving || !canRedo} onClick={onRedo}>
              <Redo2 aria-hidden />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-5" />
          </div>
          {/* C12 at 390 px: the tab strip scrolls horizontally instead of
              clipping a tab or colliding with the quick-access pair. */}
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            <TabsList aria-label={t("office.docx.toolbar.tabsLabel")} activateOnFocus>
              {DOCX_TOOLBAR_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <HomeFindGroup {...context} />
            {onSave ? (
              <Button
                type="button"
                variant="brand"
                size="sm"
                aria-disabled={readOnly || saving || !dirty || undefined}
                disabled={readOnly || saving || !dirty}
                data-testid="docx-save"
                onClick={() => onSave()}
              >
                <Save aria-hidden />
                {saving ? t("office.docx.actions.saving") : t("office.docx.actions.save")}
              </Button>
            ) : null}
          </div>
        </div>
        {onSave ? (
          <span className="sr-only" role="status" aria-live="polite">
            {t(`office.docx.saveState.${coordinator.getState().state}`)}
          </span>
        ) : null}
        {/* Row 3 (44 px): exactly one command row per tab. */}
        {DOCX_TOOLBAR_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            <ToolbarGroupStrip tab={tab} context={context} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
