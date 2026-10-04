"use client";

import {
  ChevronsRight,
  Combine,
  FilePlus2,
  ImagePlus,
  ListRestart,
  MessageSquareText,
  Redo2,
  RotateCw,
  Save,
  Scissors,
  Search,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { PDF_COMMANDS, type PdfCommandId } from "../pdf-command-map";
import type { PdfToolbarCommand, PdfToolbarTab } from "../toolbar";

const TAB_ORDER: readonly PdfToolbarTab[] = ["home", "annotate", "edit", "pages", "view"];

const TAB_LABEL_KEYS: Readonly<Record<PdfToolbarTab, string>> = {
  home: "office.pdf.chrome.tabs.home",
  annotate: "office.pdf.chrome.tabs.annotate",
  edit: "office.pdf.chrome.tabs.edit",
  pages: "office.pdf.chrome.tabs.pages",
  view: "office.pdf.chrome.tabs.view",
};

const COMMAND_LABEL_KEYS: Readonly<Record<PdfCommandId, string>> = {
  [PDF_COMMANDS.undo]: "office.pdf.actions.undo",
  [PDF_COMMANDS.redo]: "office.pdf.actions.redo",
  [PDF_COMMANDS.save]: "office.pdf.actions.save",
  [PDF_COMMANDS.annotations]: "office.pdf.commands.annotations",
  [PDF_COMMANDS.editText]: "office.pdf.commands.editText",
  [PDF_COMMANDS.replaceImage]: "office.pdf.commands.replaceImage",
  [PDF_COMMANDS.insertPage]: "office.pdf.commands.insertPage",
  [PDF_COMMANDS.deletePage]: "office.pdf.commands.deletePage",
  [PDF_COMMANDS.rotatePage]: "office.pdf.commands.rotatePage",
  [PDF_COMMANDS.reorderPage]: "office.pdf.commands.reorderPage",
  [PDF_COMMANDS.extractPage]: "office.pdf.commands.extractPage",
  [PDF_COMMANDS.mergePages]: "office.pdf.commands.mergePages",
};

/**
 * Fixed command order per tab. Each inner array is one group; a divider sits
 * between groups and each control appears once per tab. Undo/redo live once, in
 * the tab row's quick-access pair (C6), and Save belongs to the shared header
 * cluster (C2) — neither is repeated here. Kept as data so the row stays a
 * single line at every width (C7).
 */
const COMMAND_GROUPS: Readonly<Record<PdfToolbarTab, readonly (readonly PdfCommandId[])[]>> = {
  home: [],
  annotate: [[PDF_COMMANDS.annotations]],
  edit: [[PDF_COMMANDS.editText, PDF_COMMANDS.replaceImage]],
  pages: [
    [PDF_COMMANDS.insertPage, PDF_COMMANDS.deletePage, PDF_COMMANDS.rotatePage],
    [PDF_COMMANDS.reorderPage, PDF_COMMANDS.extractPage, PDF_COMMANDS.mergePages],
  ],
  view: [],
};

/** Mirrors the toolbar's fallback so an iconless command still reads below 768px. */
const DEFAULT_ICONS: Readonly<Partial<Record<PdfCommandId, ReactNode>>> = {
  [PDF_COMMANDS.undo]: <Undo2 aria-hidden />,
  [PDF_COMMANDS.redo]: <Redo2 aria-hidden />,
  [PDF_COMMANDS.save]: <Save aria-hidden />,
  [PDF_COMMANDS.annotations]: <MessageSquareText aria-hidden />,
  [PDF_COMMANDS.editText]: <Type aria-hidden />,
  [PDF_COMMANDS.replaceImage]: <ImagePlus aria-hidden />,
  [PDF_COMMANDS.insertPage]: <FilePlus2 aria-hidden />,
  [PDF_COMMANDS.deletePage]: <Trash2 aria-hidden />,
  [PDF_COMMANDS.rotatePage]: <RotateCw aria-hidden />,
  [PDF_COMMANDS.reorderPage]: <ListRestart aria-hidden />,
  [PDF_COMMANDS.extractPage]: <Scissors aria-hidden />,
  [PDF_COMMANDS.mergePages]: <Combine aria-hidden />,
};

/** Below the 768px breakpoint whole groups move into the trailing overflow menu. */
function useWideCommandRow(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    setWide(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);
  return wide;
}

export interface PdfRibbonBarProps {
  activeTab: PdfToolbarTab;
  onTabChange: (tab: PdfToolbarTab) => void;
  commands: readonly PdfToolbarCommand[];
  onCommand?: (id: PdfCommandId) => void;
  findOpen: boolean;
  onFindToggle: () => void;
}

/**
 * The PDF ribbon frame: a 40px tab row (quick undo/redo far left, tabs in the
 * middle, Find far right) over a single 44px command row. Presentational — every
 * command is a callback and nothing here touches the office engine. Selection
 * and position text live in the status bar, never in the ribbon (C6). The
 * command row renders only for a tab that has commands, so a tab with none
 * leaves no empty band (C5).
 */
export function PdfRibbonBar({
  activeTab,
  onTabChange,
  commands,
  onCommand,
  findOpen,
  onFindToggle,
}: PdfRibbonBarProps) {
  const { t } = useTranslation();
  const wide = useWideCommandRow();
  const commandById = new Map(commands.map((command) => [command.id, command] as const));
  const groups = COMMAND_GROUPS[activeTab]
    .map((group) => group.filter((id) => commandById.has(id)))
    .filter((group) => group.length > 0);
  const visibleGroups = wide ? groups : groups.slice(0, 1);
  const overflowGroups = wide ? [] : groups.slice(1);

  const runCommand = (command: PdfToolbarCommand) => {
    command.onExecute?.();
    onCommand?.(command.id);
  };

  const undo = commandById.get(PDF_COMMANDS.undo);
  const redo = commandById.get(PDF_COMMANDS.redo);

  const labelFor = (id: PdfCommandId) => commandById.get(id)?.label ?? t(COMMAND_LABEL_KEYS[id]);

  const renderCommand = (id: PdfCommandId) => {
    const command = commandById.get(id);
    if (!command) return null;
    const label = labelFor(id);
    return (
      <Button
        key={id}
        type="button"
        variant="toolbar"
        size="sm"
        aria-label={label}
        data-command={id}
        disabled={command.disabled}
        onClick={() => runCommand(command)}
      >
        {command.icon ?? DEFAULT_ICONS[id]}
        <span className="hidden md:inline">{label}</span>
      </Button>
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col border-b border-border" data-testid="pdf-ribbon-bar">
        <div className="flex min-h-10 items-center gap-1 bg-muted/30 px-2" data-testid="pdf-chrome-tab-row">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="toolbar"
                  size="icon-sm"
                  data-testid="pdf-chrome-undo"
                  aria-label={t("office.pdf.chrome.undo")}
                  disabled={!undo || undo.disabled}
                  onClick={() => undo && runCommand(undo)}
                />
              }
            >
              <Undo2 aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("office.pdf.chrome.undo")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="toolbar"
                  size="icon-sm"
                  data-testid="pdf-chrome-redo"
                  aria-label={t("office.pdf.chrome.redo")}
                  disabled={!redo || redo.disabled}
                  onClick={() => redo && runCommand(redo)}
                />
              }
            >
              <Redo2 aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("office.pdf.chrome.redo")}</TooltipContent>
          </Tooltip>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (TAB_ORDER.includes(value as PdfToolbarTab)) onTabChange(value as PdfToolbarTab);
            }}
            className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
            data-testid="pdf-chrome-tabs"
          >
            <TabsList variant="line" aria-label={t("office.pdf.chrome.tabsLabel")}>
              {TAB_ORDER.map((tab) => (
                <TabsTrigger key={tab} value={tab} data-testid={`pdf-chrome-tab-${tab}`}>
                  {t(TAB_LABEL_KEYS[tab])}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ToggleGroup
            value={findOpen ? ["find"] : []}
            onValueChange={() => onFindToggle()}
            className="shrink-0"
            data-testid="pdf-chrome-find-group"
          >
            <ToggleGroupItem
              value="find"
              variant="toolbar"
              size="sm"
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              data-testid="pdf-chrome-find"
              aria-label={t("office.pdf.chrome.find")}
            >
              <Search aria-hidden />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {groups.length > 0 ? (
          <div
            className="flex min-h-11 items-center gap-1 overflow-hidden bg-muted/30 px-2"
            data-testid="pdf-chrome-command-row"
            role="toolbar"
            aria-label={t("office.pdf.chrome.commandsLabel")}
          >
            {visibleGroups.map((group, index) => (
              <Fragment key={`group-${index}`}>
                {index > 0 ? <span className="mx-1 h-5 w-px bg-border" aria-hidden /> : null}
                <div className="flex items-center gap-1">{group.map(renderCommand)}</div>
              </Fragment>
            ))}
            <div className="min-w-0 flex-1" />
            {overflowGroups.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button type="button" variant="toolbar" size="icon-sm" />}
                  data-testid="pdf-chrome-overflow"
                  aria-label={t("office.pdf.chrome.overflow")}
                >
                  <ChevronsRight aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label={t("office.pdf.chrome.overflow")}>
                  {overflowGroups.map((group, index) => (
                    <Fragment key={`overflow-${index}`}>
                      {index > 0 ? <DropdownMenuSeparator /> : null}
                      {group.map((id) => {
                        const command = commandById.get(id);
                        if (!command) return null;
                        return (
                          <DropdownMenuItem key={id} disabled={command.disabled} onClick={() => runCommand(command)}>
                            {command.icon ?? DEFAULT_ICONS[id]}
                            {labelFor(id)}
                          </DropdownMenuItem>
                        );
                      })}
                    </Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
