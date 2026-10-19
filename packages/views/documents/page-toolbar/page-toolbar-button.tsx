"use client";

import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ShortcutKeycaps } from "../../editor/shortcut-keycaps";
import type { ToolbarTool } from "./page-toolbar-model";

export const TOOLBAR_BUTTON_CLASS = "pointer-coarse:size-11 pointer-coarse:min-w-11";

/** One toolbar glyph button. Pressing it must never steal the editor selection. */
export function ToolbarButton({
  tool, pressed, disabled, tabIndex, onRun, onFocus, triggerRef, popupOpen,
}: {
  tool: ToolbarTool;
  pressed: boolean;
  disabled: boolean;
  tabIndex: number;
  onRun: () => void;
  onFocus: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
  /** Set when the button opens a popup (link): reflected as aria-expanded. */
  popupOpen?: boolean;
}) {
  const { t } = useTranslation();
  const label = t(`documents.page_ui.toolbar.${tool.id}`);
  const Icon = tool.icon;
  const hint: ReactNode = tool.shortcut
    ? <ShortcutKeycaps shortcut={tool.shortcut} className="ml-1.5" />
    : tool.alias ? <Kbd className="ml-1.5">{tool.alias}</Kbd> : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            ref={triggerRef}
            data-tool={tool.id}
            aria-label={label}
            aria-expanded={popupOpen}
            pressed={pressed}
            disabled={disabled}
            tabIndex={tabIndex}
            className={cn(TOOLBAR_BUTTON_CLASS)}
            onPressedChange={onRun}
            onFocus={onFocus}
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        <Icon aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
