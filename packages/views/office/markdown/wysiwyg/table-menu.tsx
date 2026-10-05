"use client";

/**
 * MarkdownTableMenu — the Markdown table context toolbar (M3).
 *
 * It is the C9-allowed contextual surface for tables: a small toolbar that
 * appears only while the selection sits inside a table and offers the eight
 * structural commands (add/delete row, add/delete column, toggle header row,
 * delete table). It is NOT a command button parked over the canvas: with the
 * selection anywhere else it renders nothing at all.
 *
 * The commands themselves live in `table-menu-items.ts` as pure data; this file
 * only decides WHERE the toolbar sits and WHICH of those commands each button
 * runs. Positioning mirrors the existing selection bubble menu
 * (`packages/views/editor/bubble-menu.tsx`): a virtual reference anchored to the
 * table's box, `computePosition` + `autoUpdate` from @floating-ui/dom, and a
 * portal to `document.body` so no ancestor's `overflow: hidden` clips it.
 *
 * Visibility is read from the live editor through `useEditorState` (a precise
 * subscription), and the read-only guard lives in `isMarkdownTableMenuVisible`,
 * so a read-only document offers no toolbar rather than a row of inert buttons.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, hide, offset, shift } from "@floating-ui/dom";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { posToDOMRect } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import {
  findTablePosition,
  isMarkdownTableMenuVisible,
  MARKDOWN_TABLE_MENU_ACTIONS,
} from "./table-menu-items";

export interface MarkdownTableMenuProps {
  /** The live M1 editor instance, or null before it mounts. */
  editor: Editor | null;
}

export function MarkdownTableMenu({ editor }: MarkdownTableMenuProps) {
  const { t } = useTranslation();
  const floatingRef = useRef<HTMLDivElement>(null);
  const [positioned, setPositioned] = useState(false);

  // Precise subscription: re-render only when the table context flips, not on
  // every transaction. `tablePos` doubles as the anchor and the visibility key.
  const visible = useEditorState({
    editor,
    selector: ({ editor: live }) => isMarkdownTableMenuVisible(live),
  }) ?? false;
  const tablePos = useEditorState({
    editor,
    selector: ({ editor: live }) => findTablePosition(live),
  }) ?? null;

  // Virtual reference: the table's own box when the DOM node is reachable,
  // otherwise the selection rect (jsdom, or a node view that wraps the table).
  const virtualRef = useMemo(
    () => ({
      getBoundingClientRect: () => {
        if (!editor || editor.isDestroyed) return new DOMRect();
        if (tablePos !== null) {
          const node = editor.view.nodeDOM(tablePos);
          if (node instanceof HTMLElement) {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) return rect;
          }
        }
        const { from, to } = editor.state.selection;
        return posToDOMRect(editor.view, from, to);
      },
      contextElement: editor?.view.dom,
    }),
    [editor, tablePos],
  );

  // Anchor above the table, flipping below when there is no room, and hide when
  // the table is scrolled out of the viewport (the hide middleware).
  useEffect(() => {
    const el = floatingRef.current;
    if (!visible || !el || !editor || editor.isDestroyed) return undefined;
    const update = () => {
      void computePosition(virtualRef, el, {
        strategy: "fixed",
        placement: "top",
        middleware: [offset(8), flip(), shift({ padding: 8 }), hide()],
      }).then(({ x, y, middlewareData }) => {
        if (!el.isConnected) return;
        el.style.visibility = middlewareData.hide?.referenceHidden ? "hidden" : "visible";
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        setPositioned(true);
      });
    };
    const cleanup = autoUpdate(virtualRef, el, update);
    return () => {
      cleanup();
      setPositioned(false);
    };
  }, [editor, visible, virtualRef]);

  if (!visible || !editor) return null;

  const portalHost = editor.view.dom.ownerDocument.body;

  return createPortal(
    // `role="toolbar"` is what keeps this a non-static element: the rule the
    // bubble menu has to disable does not fire here, and `onMouseDown` is the
    // focus-steal guard every floating editor menu carries.
    <div
      ref={floatingRef}
      role="toolbar"
      aria-label={t("office.markdown.table.label")}
      data-testid="md-table-menu"
      className="z-50 flex w-max items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-1 text-popover-foreground shadow-[var(--menu-shadow)]"
      style={{ position: "fixed", visibility: positioned ? "visible" : "hidden" }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <TooltipProvider delay={300}>
        {MARKDOWN_TABLE_MENU_ACTIONS.map((action, index) => (
          <span key={action.id} className="flex items-center">
            {index === MARKDOWN_TABLE_MENU_ACTIONS.length - 1 ? (
              <Separator orientation="vertical" className="mx-0.5 h-5" />
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="toolbar"
                    size="icon-sm"
                    aria-label={t(action.labelKey)}
                    data-table-action={action.id}
                    onClick={() => action.run(editor)}
                  />
                }
              >
                <action.icon aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {t(action.labelKey)}
              </TooltipContent>
            </Tooltip>
          </span>
        ))}
      </TooltipProvider>
    </div>,
    portalHost,
  );
}
