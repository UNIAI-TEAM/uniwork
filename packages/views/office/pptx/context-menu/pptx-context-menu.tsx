"use client";

/**
 * A7 (UNI-927) - the slide-canvas context menu.
 *
 * Right-clicking the canvas opens the rows `buildPptxContextMenu` produced from
 * the editor's real facts. The component owns no capability logic: it renders a
 * row as a working item only when the model says it can run, and a disabled row
 * always shows its reason in the row text (a native `title` never reaches a
 * keyboard user, and the reason is the point of the disabled row).
 *
 * The trigger wraps the canvas box, so a right-click anywhere on the slide opens
 * the menu at the pointer and the canvas keeps its existing keyboard/selection
 * contract untouched.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { buildPptxContextMenu, type PptxContextMenuAction, type PptxContextMenuContext } from "./context-menu-model";

export interface PptxContextMenuProps extends Partial<PptxContextMenuContext> {
  /** Runs the chosen action. A disabled row never reaches here. */
  onAction: (action: PptxContextMenuAction) => void;
  children: ReactNode;
  className?: string;
}

export function PptxContextMenu({ onAction, children, className, ...context }: PptxContextMenuProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.context_menu" });
  const rows = buildPptxContextMenu(context);

  return (
    <ContextMenu>
      <ContextMenuTrigger className={cn("contents", className)} data-pptx-context-menu-trigger>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52" data-pptx-context-menu>
        {rows.map((entry) => (
          <div key={entry.action} className="contents">
            {entry.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              disabled={!entry.enabled}
              variant={entry.destructive ? "destructive" : "default"}
              data-pptx-context-item={entry.action}
              data-capability={entry.enabled ? "available" : "unavailable"}
              title={entry.enabled ? undefined : entry.reasonKey ? t(entry.reasonKey) : undefined}
              onClick={() => {
                if (entry.enabled) onAction(entry.action);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{t(entry.labelKey, entry.labelVars)}</span>
              {entry.shortcut ? <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut> : null}
              {!entry.enabled && entry.reasonKey ? (
                <span className="max-w-44 shrink-0 truncate text-caption text-muted-foreground" data-pptx-context-reason>
                  {t(entry.reasonKey)}
                </span>
              ) : null}
            </ContextMenuItem>
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}