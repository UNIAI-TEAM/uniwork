"use client";

import { Fragment, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Redo2, Save, Undo2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { partitionToolbarGroups } from "./overflow";
import { DOCX_TOOLBAR_TABS } from "./tabs/tabs";
import { useRovingToolbar } from "./use-roving-toolbar";
import { useToolbarWidth } from "./use-toolbar-width";
import type { DocxToolbarGroup, DocxToolbarGroupContext, DocxToolbarProps, DocxToolbarTab } from "./types";

function ToolbarGroupView({ group, context, label }: { group: DocxToolbarGroup; context: DocxToolbarGroupContext; label: string }) {
  const Group = group.component;
  return (
    <div role="group" aria-label={label} data-toolbar-group={group.id} className="flex items-center gap-1">
      <Group {...context} />
    </div>
  );
}

/** One tab's command strip: inline groups plus the overflow popover for the
 * groups the current width collapses. */
function ToolbarGroupStrip({ tab, context }: { tab: DocxToolbarTab; context: DocxToolbarGroupContext }) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const width = useToolbarWidth(stripRef);
  useRovingToolbar(stripRef);
  const { inline, collapsed } = partitionToolbarGroups(tab.groups, width);

  return (
    <div
      ref={stripRef}
      role="toolbar"
      aria-label={t("office.docx.toolbar.label")}
      data-testid="docx-toolbar-groups"
      className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1"
    >
      {inline.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <Separator orientation="vertical" className="mx-1 h-5" /> : null}
          <ToolbarGroupView group={group} context={context} label={t(group.labelKey)} />
        </Fragment>
      ))}
      {collapsed.length > 0 ? (
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.toolbar.overflow")} data-testid="docx-toolbar-overflow" />}>
            <MoreHorizontal aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
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
 * The tabbed DOCX toolbar shell. It owns the tab list, the quick-access row
 * (undo/redo, selection status, Save) and the group strip; every command group
 * plugs in through DOCX_TOOLBAR_TABS and the shared context in ./types.ts.
 */
export function DocxToolbarShell(context: DocxToolbarProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DocxToolbarTab["id"]>("home");
  const { coordinator, selection, readOnly = false, saving, dirty, canUndo, canRedo, onUndo, onRedo, onSave } = context;
  const selectionLabel = selection
    ? t("office.docx.selection.range", { from: selection.from, to: selection.to })
    : t("office.docx.selection.none");

  return (
    <div className="flex flex-col border-b border-border bg-muted/30" data-testid="docx-toolbar">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DocxToolbarTab["id"])} className="gap-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
          {/* Selection follows focus, the ribbon behaviour Word and the
              registry's Radix-style tabs use; the panels are cheap to render. */}
          <TabsList aria-label={t("office.docx.toolbar.tabsLabel")} activateOnFocus>
            {DOCX_TOOLBAR_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.undo")} disabled={readOnly || saving || !canUndo} onClick={onUndo}>
              <Undo2 aria-hidden />
            </Button>
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.redo")} disabled={readOnly || saving || !canRedo} onClick={onRedo}>
              <Redo2 aria-hidden />
            </Button>
            <span className="min-w-0 max-w-64 flex-1 truncate px-2 text-caption text-muted-foreground" data-testid="docx-selection">
              {selectionLabel}
            </span>
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
            {onSave ? (
              <span className="sr-only" role="status" aria-live="polite">
                {t(`office.docx.saveState.${coordinator.getState().state}`)}
              </span>
            ) : null}
          </div>
        </div>
        {DOCX_TOOLBAR_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            <ToolbarGroupStrip tab={tab} context={context} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
