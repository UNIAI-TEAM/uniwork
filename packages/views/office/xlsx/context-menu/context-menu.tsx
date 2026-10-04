"use client";

// Wave A / A9 (UNI-926): the grid context menu. It renders the pure list from
// `menu-items.ts` through the UniWork DropdownMenu primitives (Base UI menu:
// `role="menu"`, roving focus, ArrowUp/Down, Home/End, Escape). A right click
// anchors it to the cursor through a virtual element; every item dispatches
// through the SAME commands port and editor callbacks the toolbar groups use,
// so there is no second command or save path. Disabled items keep `aria-disabled`
// and stay rendered - never hidden - mirroring the toolbar controls.

import { Fragment, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  buildXlsxContextMenu,
  type XlsxContextMenuCallback,
  type XlsxContextMenuEntry,
  type XlsxContextMenuState,
} from "./menu-items";

/** A zero-size virtual anchor at the right-click point. The DOMRect is built
 *  by hand so the menu never depends on `DOMRect.fromRect` (absent in jsdom). */
function anchorAtPoint(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
  return {
    getBoundingClientRect: () =>
      ({ x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y }) as DOMRect,
  };
}

export interface XlsxContextMenuProps {
  /** Viewport coordinates of the right click. */
  point: { x: number; y: number };
  state: XlsxContextMenuState;
  /** The grid element focus returns to once the menu closes. */
  focusTarget?: HTMLElement | null;
  onClose: () => void;
  /** Editor-owned callbacks (cut/copy/paste/find) the menu cannot run itself. */
  onRunCallback: (callback: XlsxContextMenuCallback) => void;
}

export function XlsxContextMenu({ point, state, focusTarget, onClose, onRunCallback }: XlsxContextMenuProps) {
  const { t } = useTranslation();
  const entries = useMemo(() => buildXlsxContextMenu(state), [state]);
  const anchor = useMemo(() => anchorAtPoint(point.x, point.y), [point.x, point.y]);

  // Every close path - Escape, outside press, an item press - funnels through
  // here, so focus lands back on the grid for the next keystroke.
  const close = useCallback(() => {
    onClose();
    focusTarget?.focus?.();
  }, [focusTarget, onClose]);

  const run = useCallback(
    (entry: XlsxContextMenuEntry) => {
      if (entry.disabled || !entry.action) return;
      const action = entry.action;
      if (action.kind === "command") {
        try {
          state.commands?.execute(action.id, action.params);
        } catch {
          // Eight of the menu's items target pinned handlers that are async in
          // the built bundle; the synchronous port throws the known TypeError
          // after the edit has already applied and journalled. Absorb it here
          // (mirroring toolbar/sort-group.tsx and toolbar/filter-group.tsx) so
          // the throw never escapes the item's React onClick.
        }
      } else {
        onRunCallback(action.callback);
      }
      // Base UI closes the menu on the item press (closeOnClick), which funnels
      // through onOpenChange -> close(), so focus returns exactly once.
    },
    [onRunCallback, state.commands],
  );

  return (
    <DropdownMenu open onOpenChange={(next) => { if (!next) close(); }}>
      <DropdownMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        data-testid="xlsx-context-menu"
        className="min-w-52"
      >
        {entries.map((entry) => (
          <Fragment key={entry.id}>
            {entry.separatorBefore ? <DropdownMenuSeparator /> : null}
            {entry.children ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={entry.disabled}
                  data-testid={`xlsx-context-${entry.id}`}
                >
                  {t(entry.labelKey)}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  data-testid={`xlsx-context-${entry.id}-menu`}
                  className="max-h-80 min-w-44 overflow-y-auto"
                >
                  {entry.children.map((child) => (
                    <DropdownMenuItem
                      key={child.id}
                      disabled={child.disabled}
                      data-testid={`xlsx-context-${child.id}`}
                      onClick={() => run(child)}
                    >
                      {t(child.labelKey)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem
                disabled={entry.disabled}
                data-testid={`xlsx-context-${entry.id}`}
                onClick={() => run(entry)}
              >
                {t(entry.labelKey)}
              </DropdownMenuItem>
            )}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}