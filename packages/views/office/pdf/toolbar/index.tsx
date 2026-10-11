"use client";

import {
  FilePlusCorner,
  ImagePlus,
  Ellipsis,
  RotateCw,
  Save,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Redo2,
  Combine,
  ListRestart,
  MessageSquareText,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { PDF_COMMANDS, type PdfCommandId } from "../pdf-command-map";

export type PdfToolbarTab = "home" | "annotate" | "edit" | "pages" | "view";

export interface PdfToolbarCommand {
  id: PdfCommandId;
  label?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onExecute?: () => void;
}

export interface PdfToolbarShellProps {
  commands?: readonly PdfToolbarCommand[];
  defaultTab?: PdfToolbarTab;
  activeTab?: PdfToolbarTab;
  onTabChange?: (tab: PdfToolbarTab) => void;
  /** Number of commands kept in the tab strip before moving the rest to More. */
  maxVisibleCommands?: number;
  className?: string;
  onCommand?: (id: PdfCommandId) => void;
}

const TAB_ORDER: readonly PdfToolbarTab[] = ["home", "annotate", "edit", "pages", "view"];
const COMMAND_TABS: Readonly<Record<PdfCommandId, PdfToolbarTab>> = {
  [PDF_COMMANDS.undo]: "home",
  [PDF_COMMANDS.redo]: "home",
  [PDF_COMMANDS.save]: "home",
  [PDF_COMMANDS.annotations]: "annotate",
  [PDF_COMMANDS.highlight]: "annotate",
  [PDF_COMMANDS.note]: "annotate",
  [PDF_COMMANDS.stamp]: "annotate",
  [PDF_COMMANDS.forms]: "annotate",
  [PDF_COMMANDS.editText]: "edit",
  [PDF_COMMANDS.replaceImage]: "edit",
  [PDF_COMMANDS.insertPage]: "pages",
  [PDF_COMMANDS.deletePage]: "pages",
  [PDF_COMMANDS.rotatePage]: "pages",
  [PDF_COMMANDS.reorderPage]: "pages",
  [PDF_COMMANDS.extractPage]: "pages",
  [PDF_COMMANDS.mergePages]: "pages",
  [PDF_COMMANDS.zoomOut]: "view",
  [PDF_COMMANDS.zoomIn]: "view",
  [PDF_COMMANDS.fitWidth]: "view",
  [PDF_COMMANDS.fitPage]: "view",
};

const DEFAULT_ICONS: Readonly<Partial<Record<PdfCommandId, ReactNode>>> = {
  [PDF_COMMANDS.undo]: <Undo2 aria-hidden />,
  [PDF_COMMANDS.redo]: <Redo2 aria-hidden />,
  [PDF_COMMANDS.save]: <Save aria-hidden />,
  [PDF_COMMANDS.annotations]: <MessageSquareText aria-hidden />,
  [PDF_COMMANDS.editText]: <Type aria-hidden />,
  [PDF_COMMANDS.replaceImage]: <ImagePlus aria-hidden />,
  [PDF_COMMANDS.insertPage]: <FilePlusCorner aria-hidden />,
  [PDF_COMMANDS.deletePage]: <Trash2 aria-hidden />,
  [PDF_COMMANDS.rotatePage]: <RotateCw aria-hidden />,
  [PDF_COMMANDS.reorderPage]: <ListRestart aria-hidden />,
  [PDF_COMMANDS.extractPage]: <Scissors aria-hidden />,
  [PDF_COMMANDS.mergePages]: <Combine aria-hidden />,
};

const TAB_LABEL_KEYS: Readonly<Record<PdfToolbarTab, string>> = {
  home: "office.pdf.tabs.home",
  annotate: "office.pdf.tabs.annotate",
  edit: "office.pdf.tabs.edit",
  pages: "office.pdf.tabs.pages",
  view: "office.pdf.tabs.view",
};

function defaultCommandLabel(t: (key: string) => string, id: PdfCommandId): string {
  const keys: Readonly<Record<PdfCommandId, string>> = {
    [PDF_COMMANDS.undo]: "office.pdf.actions.undo",
    [PDF_COMMANDS.redo]: "office.pdf.actions.redo",
    [PDF_COMMANDS.save]: "office.pdf.actions.save",
    [PDF_COMMANDS.annotations]: "office.pdf.commands.annotations",
    [PDF_COMMANDS.highlight]: "office.pdf.commands.highlight",
    [PDF_COMMANDS.note]: "office.pdf.commands.note",
    [PDF_COMMANDS.stamp]: "office.pdf.commands.stamp",
    [PDF_COMMANDS.forms]: "office.pdf.commands.forms",
    [PDF_COMMANDS.editText]: "office.pdf.commands.editText",
    [PDF_COMMANDS.replaceImage]: "office.pdf.commands.replaceImage",
    [PDF_COMMANDS.insertPage]: "office.pdf.commands.insertPage",
    [PDF_COMMANDS.deletePage]: "office.pdf.commands.deletePage",
    [PDF_COMMANDS.rotatePage]: "office.pdf.commands.rotatePage",
    [PDF_COMMANDS.reorderPage]: "office.pdf.commands.reorderPage",
    [PDF_COMMANDS.extractPage]: "office.pdf.commands.extractPage",
    [PDF_COMMANDS.mergePages]: "office.pdf.commands.mergePages",
    [PDF_COMMANDS.zoomOut]: "office.pdf.commands.zoomOut",
    [PDF_COMMANDS.zoomIn]: "office.pdf.commands.zoomIn",
    [PDF_COMMANDS.fitWidth]: "office.pdf.commands.fitWidth",
    [PDF_COMMANDS.fitPage]: "office.pdf.commands.fitPage",
  };
  return t(keys[id]);
}

function CommandButton({ command, t, onCommand }: { command: PdfToolbarCommand; t: (key: string) => string; onCommand?: (id: PdfCommandId) => void }) {
  const label = command.label || defaultCommandLabel(t, command.id);
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      aria-label={label}
      data-command={command.id}
      disabled={command.disabled}
      onClick={() => { command.onExecute?.(); onCommand?.(command.id); }}
    >
      {command.icon ?? DEFAULT_ICONS[command.id]}
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}

/**
 * PDF's command surface is grouped like the desktop ribbon while retaining a
 * compact, keyboard friendly tab strip. Commands remain callbacks so the
 * toolbar cannot bypass the host's PDF command contract.
 */
export function PdfToolbarShell({
  commands = [],
  defaultTab = "home",
  activeTab,
  onTabChange,
  maxVisibleCommands = 4,
  className,
  onCommand,
}: PdfToolbarShellProps) {
  const { t } = useTranslation();
  const [uncontrolledTab, setUncontrolledTab] = useState<PdfToolbarTab>(defaultTab);
  const tab = activeTab ?? uncontrolledTab;
  const selectedCommands = useMemo(
    () => commands.filter((command) => COMMAND_TABS[command.id] === tab),
    [commands, tab],
  );
  const visibleCommands = selectedCommands.slice(0, Math.max(0, maxVisibleCommands));
  const overflowCommands = selectedCommands.slice(Math.max(0, maxVisibleCommands));
  const selectTab = (value: string) => {
    if (!TAB_ORDER.includes(value as PdfToolbarTab)) return;
    const next = value as PdfToolbarTab;
    setUncontrolledTab(next);
    onTabChange?.(next);
  };

  return (
    <div
      className={cn("flex min-h-11 min-w-0 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1", className)}
      data-testid="pdf-toolbar-shell"
      data-active-tab={tab}
      aria-label={t("office.pdf.toolbar.label")}
      role="toolbar"
    >
      <Tabs value={tab} onValueChange={selectTab} className="min-w-0">
        <TabsList
          variant="line"
          aria-label={t("office.pdf.toolbar.tabsLabel")}
          onKeyDown={(event) => {
            if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
            const key = event.key;
            const currentIndex = TAB_ORDER.indexOf(tab);
            const nextIndex = key === "ArrowRight" || key === "ArrowDown"
              ? (currentIndex + 1) % TAB_ORDER.length
              : key === "ArrowLeft" || key === "ArrowUp"
                ? (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
                : key === "Home"
                  ? 0
                  : key === "End"
                    ? TAB_ORDER.length - 1
                    : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            selectTab(TAB_ORDER[nextIndex]!);
          }}
        >
          {TAB_ORDER.map((item) => (
            <TabsTrigger key={item} value={item} data-testid={`pdf-toolbar-tab-${item}`}>
              {t(TAB_LABEL_KEYS[item])}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-testid="pdf-toolbar-commands">
        {visibleCommands.map((command) => <CommandButton key={command.id} command={command} onCommand={onCommand} t={t} />)}
        {overflowCommands.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="toolbar" size="icon-sm" />}
              aria-label={t("office.pdf.toolbar.more")}
              data-testid="pdf-toolbar-more"
            >
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={t("office.pdf.toolbar.more")}>
              {overflowCommands.map((command) => (
                <DropdownMenuItem key={command.id} disabled={command.disabled} onClick={() => { command.onExecute?.(); onCommand?.(command.id); }}>
                  {command.icon ?? DEFAULT_ICONS[command.id]}
                  {command.label || defaultCommandLabel(t, command.id)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

export { COMMAND_TABS };
