"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  applyLink,
  copyLinkHref,
  getActiveLink,
  LinkDialog,
  openLinkHref,
  readLinkSeed,
  removeLink,
  type DocxLinkSeed,
} from "../links";
import {
  copySelection,
  cutSelection,
  insertPastePayload,
  readClipboardPayload,
  readClipboardText,
  selectAll,
} from "./clipboard-actions";
import { buildDocxMenuSections, readDocxMenuContext, type DocxMenuItemId } from "./menu-model";
import { insertPlainText, pastePayloadFromDataTransfer } from "./paste-options";
import { DocxPasteChip } from "./paste-chip";
import {
  deleteTableColumn,
  deleteTableRow,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  mergeSelectedCells,
  splitSelectedCell,
  toggleHeaderRow,
} from "./table-actions";
import { useDocxPasteOptions, type DocxPasteOptionsController } from "./use-docx-paste-options";

/** Whether a document position resolves inside a docTable. */
function positionInsideTable(editor: Editor, position: number): boolean {
  const $pos = editor.state.doc.resolve(position);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === "docTable") return true;
  }
  return false;
}

/**
 * Move the caret to a right-click inside the document, Word's behavior: the
 * menu's commands then act on the clicked block/cell. ProseMirror itself never
 * moves the selection on a secondary-button press, which is why the mounted
 * menu used to show only the clipboard verbs even inside a table or on a link.
 *
 * The click is resolved from the DOM node under the pointer (exact for a cell
 * or a link); only a click that really lands inside the document moves the
 * caret, so a right-click on the surrounding chrome or padding leaves the
 * selection alone, and a click inside a multi-cell selection keeps it.
 */
function moveCaretToContextMenuPoint(editor: Editor, event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Node) || !editor.view.dom.contains(target)) return;
  let position = -1;
  if (target !== editor.view.dom) {
    try {
      position = editor.view.posAtDOM(target, 0);
    } catch {
      position = -1;
    }
  }
  if (position < 0) {
    try {
      position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? -1;
    } catch {
      position = -1;
    }
  }
  if (position < 0 || position > editor.state.doc.content.size) return;
  const current = editor.state.selection;
  // A multi-cell selection survives a right-click inside its table so Merge
  // cells stays reachable (Word keeps it); a click outside the table falls
  // through and moves the caret like any other.
  if (current instanceof CellSelection && positionInsideTable(editor, position)) return;
  if (!current.empty && position >= current.from && position <= current.to) return;
  const selection = TextSelection.near(editor.state.doc.resolve(position));
  if (selection.eq(current)) return;
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

export interface DocxContextMenuSurfaceProps {
  editor: Editor;
  /** Host capability gate; read-only keeps copy and link opening, blocks mutations. */
  readOnly?: boolean;
  /** Layout classes for the trigger wrapper; defaults to a box-less `contents`. */
  className?: string;
  children?: ReactNode;
  /** Test/host seam: reuse a paste-options controller instead of creating one. */
  pasteOptions?: DocxPasteOptionsController;
}

/**
 * Wraps the document surface: right-click opens the Word-shaped menu (clipboard
 * verbs, table commands when the click is in a table, link commands when it is
 * on a link), and a paste shows the paste-options chip near the caret. The
 * chrome wiring follow-up mounts this around `renderSurface()`; nothing here
 * reaches the save path.
 */
export function DocxContextMenuSurface({
  editor,
  readOnly = false,
  className = "contents",
  children,
  pasteOptions,
}: DocxContextMenuSurfaceProps) {
  const { t } = useTranslation();
  const [linkSeed, setLinkSeed] = useState<DocxLinkSeed | null>(null);
  const paste = useDocxPasteOptions(editor, pasteOptions ?? null);
  const chip = paste.chip;

  useEffect(() => {
    if (!chip) return undefined;
    const refresh = () => paste.refreshPosition();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [chip, paste]);

  const pasteRich = async () => {
    const payload = await readClipboardPayload();
    if (!payload) return;
    paste.notePaste(payload);
    insertPastePayload(editor, payload);
  };

  const pastePlain = async () => {
    const text = await readClipboardText();
    if (text.length > 0) insertPlainText(editor, text);
  };

  const runAction = (id: DocxMenuItemId) => {
    switch (id) {
      case "cut":
        void cutSelection(editor);
        return;
      case "copy":
        void copySelection(editor);
        return;
      case "paste":
        void pasteRich();
        return;
      case "pastePlain":
        void pastePlain();
        return;
      case "selectAll":
        selectAll(editor);
        return;
      case "insertRowAbove":
        insertRowAbove(editor);
        return;
      case "insertRowBelow":
        insertRowBelow(editor);
        return;
      case "insertColumnLeft":
        insertColumnLeft(editor);
        return;
      case "insertColumnRight":
        insertColumnRight(editor);
        return;
      case "deleteRow":
        deleteTableRow(editor);
        return;
      case "deleteColumn":
        deleteTableColumn(editor);
        return;
      case "mergeCells":
        mergeSelectedCells(editor);
        return;
      case "splitCell":
        splitSelectedCell(editor);
        return;
      case "toggleHeaderRow":
        toggleHeaderRow(editor);
        return;
      case "openLink": {
        const link = getActiveLink(editor);
        if (link) openLinkHref(link.href);
        return;
      }
      case "copyLink": {
        const link = getActiveLink(editor);
        if (link) void copyLinkHref(link.href);
        return;
      }
      case "editLink":
        setLinkSeed(readLinkSeed(editor));
        return;
      case "removeLink":
        removeLink(editor);
        return;
    }
  };

  return (
    <>
      {/* The trigger is a box-less div, so Base UI cannot restore focus to it
          when the menu closes; hand focus back to the document instead. */}
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) editor.commands.focus();
        }}
      >
        <ContextMenuTrigger
          className={className}
          data-testid="docx-context-menu-surface"
          onContextMenu={(event) => {
            // Runs before Base UI's own handler (rightmost prop wins), so the
            // caret is already at the click when the popup first renders and
            // readDocxMenuContext sees the table/link under the pointer.
            moveCaretToContextMenuPoint(editor, event.nativeEvent);
          }}
          onPasteCapture={(event) => {
            const target = event.target;
            // A paste outside the editable document (a nested control) must not arm the chip.
            if (!(target instanceof Node) || !editor.view.dom.contains(target)) return;
            paste.notePaste(pastePayloadFromDataTransfer(event.clipboardData));
          }}
        >
          {children}
          <ContextMenuContent
            aria-label={t("office.docx.contextMenu.label")}
            className="min-w-52"
            data-testid="docx-context-menu"
          >
            <DocxContextMenuItems editor={editor} readOnly={readOnly} onAction={runAction} />
          </ContextMenuContent>
        </ContextMenuTrigger>
      </ContextMenu>
      {chip && chip.position ? (
        <DocxPasteChip
          mode={chip.mode}
          style={{ position: "fixed", left: chip.position.left, top: chip.position.top }}
          onApply={paste.apply}
          onDismiss={paste.dismiss}
        />
      ) : null}
      <LinkDialog
        open={linkSeed !== null}
        onOpenChange={(open) => {
          if (!open) setLinkSeed(null);
        }}
        initial={linkSeed?.link ?? null}
        selectionText={linkSeed?.selectionText ?? ""}
        readOnly={readOnly}
        onSubmit={(value) => {
          applyLink(editor, value);
          setLinkSeed(null);
        }}
        onRemove={() => {
          removeLink(editor);
          setLinkSeed(null);
        }}
      />
    </>
  );
}

/**
 * Rendered inside the popup, so the context is read when the menu actually
 * opens (and re-read for every later render) instead of at surface mount.
 */
function DocxContextMenuItems({
  editor,
  readOnly,
  onAction,
}: {
  editor: Editor;
  readOnly: boolean;
  onAction: (id: DocxMenuItemId) => void;
}) {
  const { t } = useTranslation();
  const sections = buildDocxMenuSections(readDocxMenuContext(editor, readOnly));
  return (
    <>
      {sections.map((section, index) => (
        <Fragment key={section.id}>
          {index > 0 ? <ContextMenuSeparator /> : null}
          {section.items.map((item) => (
            <ContextMenuItem
              key={item.id}
              disabled={!item.enabled}
              data-testid={`docx-menu-${item.id}`}
              onClick={() => onAction(item.id)}
            >
              {t(item.labelKey)}
            </ContextMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  );
}
