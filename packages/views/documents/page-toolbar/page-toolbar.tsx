"use client";

import { Fragment, useCallback, useRef, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { TooltipProvider } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { LinkEditBar } from "../../editor/bubble-menu-controls";
import { focusOnKeyboardOpen, menuArrowKeys } from "./menu-keys";
import { PageHelpPopover } from "./page-help-popover";
import { PageStyleMenu } from "./page-style-menu";
import { TOOLBAR_BUTTON_CLASS, ToolbarButton } from "./page-toolbar-button";
import { TOOL_GROUPS, type ToolbarTool, type ToolContext } from "./page-toolbar-model";

interface ToolState { pressed: boolean; disabled: boolean }

/** Roving tabindex ids: the toolbar is one Tab stop, arrows move inside it. */
const STYLE_ID = "style";
const HELP_ID = "help";

export interface PageToolbarProps {
  editor: Editor;
  chooseImage: () => void;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

export function PageToolbar({ editor, chooseImage, helpOpen, onHelpOpenChange }: PageToolbarProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const linkAnchorRef = useRef<HTMLButtonElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [rovingId, setRovingId] = useState<string>("");

  const states = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const result: Record<string, ToolState> = {};
      for (const tool of TOOL_GROUPS.flat()) {
        result[tool.id] = { pressed: tool.isActive?.(e) ?? false, disabled: tool.isDisabled?.(e) ?? false };
      }
      return result;
    },
    equalityFn: (a, b) => {
      if (!a || !b) return a === b;
      return Object.keys(a).every((id) => a[id]!.pressed === b[id]?.pressed && a[id]!.disabled === b[id]?.disabled);
    },
  });

  // Base UI closes the link popover on the outside press that the Link button itself
  // causes; the click that follows must not reopen it.
  const linkClosedAt = useRef(0);
  const changeLinkOpen = useCallback((open: boolean) => {
    if (!open) linkClosedAt.current = Date.now();
    setLinkOpen(open);
  }, []);
  const context: ToolContext = {
    chooseImage,
    openLink: () => { if (Date.now() - linkClosedAt.current > 250) setLinkOpen(true); },
  };
  const run = (tool: ToolbarTool) => {
    setMoreOpen(false);
    tool.run(editor, context);
  };

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const items = Array.from(rowRef.current?.querySelectorAll<HTMLElement>("[data-tool]:not(:disabled)") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }, []);

  // The one Tab stop must survive its button turning disabled (undo emptied, caret in a table).
  const [history = [], ...rest] = TOOL_GROUPS;
  const enabled = (tool: ToolbarTool) => !states?.[tool.id]?.disabled;
  const enabledIds = [...history.filter(enabled).map((tool) => tool.id), STYLE_ID, ...rest.flat().filter(enabled).map((tool) => tool.id), HELP_ID];
  const stopId = enabledIds.includes(rovingId) ? rovingId : enabledIds[0];
  const tabIndexFor = (id: string) => (stopId === id ? 0 : -1);
  const renderTool = (tool: ToolbarTool) => {
    const isLink = tool.id === "link";
    return (
      <ToolbarButton
        key={tool.id}
        tool={tool}
        pressed={states?.[tool.id]?.pressed ?? false}
        disabled={states?.[tool.id]?.disabled ?? false}
        tabIndex={tabIndexFor(tool.id)}
        onRun={() => run(tool)}
        onFocus={() => setRovingId(tool.id)}
        triggerRef={isLink ? linkAnchorRef : undefined}
        popupOpen={isLink ? linkOpen : undefined}
      />
    );
  };

  return (
    <TooltipProvider delay={300}>
      <div className="@container flex items-center border-b border-border bg-background px-2 py-1.5 sm:px-5">
        <div
          ref={rowRef}
          role="toolbar"
          aria-label={t("documents.page_ui.toolbar.label")}
          aria-orientation="horizontal"
          className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onKeyDown={onKeyDown}
        >
          <div className="mx-auto flex w-max items-center gap-0.5">
            {/* Order follows the approved board: history, text style, then the groups. */}
            {history.map(renderTool)}
            <Separator orientation="vertical" className="mx-1.5 h-5" />
            <PageStyleMenu editor={editor} tabIndex={tabIndexFor(STYLE_ID)} onFocus={() => setRovingId(STYLE_ID)} />
            {rest.map((group, groupIndex) => (
              <Fragment key={groupIndex}>
                <Separator orientation="vertical" className="mx-1.5 h-5" />
                {group.map(renderTool)}
              </Fragment>
            ))}
            <Separator orientation="vertical" className="mx-1.5 h-5" />
            <PageHelpPopover open={helpOpen} onOpenChange={onHelpOpenChange} tabIndex={tabIndexFor(HELP_ID)} onFocus={() => setRovingId(HELP_ID)} />
          </div>
        </div>
        <Popover modal={false} open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger
            aria-label={t("documents.page_ui.toolbar.more")}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "ml-1 hidden size-8 shrink-0 items-center justify-center rounded-control outline-none hover:bg-muted @max-5xl:inline-flex",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-muted", TOOLBAR_BUTTON_CLASS,
            )}
          >
            <Ellipsis aria-hidden className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            role="menu"
            aria-label={t("documents.page_ui.toolbar.more_title")}
            side="bottom"
            align="end"
            sideOffset={6}
            className="max-h-[min(32rem,var(--available-height,32rem))] w-64 gap-0.5 overflow-y-auto p-1"
            initialFocus={focusOnKeyboardOpen}
            finalFocus={focusOnKeyboardOpen}
            onKeyDown={menuArrowKeys}
          >
            {TOOL_GROUPS.flat().map((tool) => {
              const state = states?.[tool.id];
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  type="button"
                  role={tool.isActive ? "menuitemcheckbox" : "menuitem"}
                  disabled={state?.disabled}
                  aria-checked={tool.isActive ? Boolean(state?.pressed) : undefined}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-body outline-hidden select-none hover:bg-muted focus-visible:bg-muted disabled:opacity-50 aria-checked:bg-muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(tool)}
                >
                  <Icon aria-hidden className="size-4" />
                  {t(`documents.page_ui.toolbar.${tool.id}`)}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
        <Popover modal={false} open={linkOpen} onOpenChange={changeLinkOpen}>
          <PopoverContent
            anchor={linkAnchorRef}
            side="bottom"
            align="start"
            sideOffset={6}
            className="w-auto p-1"
            initialFocus={false}
            finalFocus={false}
          >
            <LinkEditBar editor={editor} onClose={() => changeLinkOpen(false)} />
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
