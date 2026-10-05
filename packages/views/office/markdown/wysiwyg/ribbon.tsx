"use client";

/**
 * The Markdown ribbon (Amendment R, R8): the Markdown surface's tabs and
 * labelled groups, defined once as data and mounted on the shared
 * `OfficeRibbon` (UNI-931).
 *
 * It is the surface ASSEMBLER, not a second toolbar. Every Home/Insert control
 * comes from M2's `MARKDOWN_TOOLBAR_GROUPS` / `buildMarkdownGroupItems`, so the
 * block-style dropdown, the link popover, the diagram insert and the math
 * popover are the real M2/M4 components. The M4 `CodeBlockToolbar` renders as
 * its own contextual Code tab (it null-renders outside a code block), and the
 * contextual Table tab appears while the cursor is inside a table.
 *
 * The ribbon owns the tab row and the group body; undo/redo ride the ribbon's
 * quick-access slot (C6) and Find plus the Source | Visual control its trailing
 * slot (C6/C11). Nothing here draws a floating control over the canvas (C9).
 *
 * There is deliberately NO Clipboard group: Markdown has no paste/cut/copy
 * command in the ribbon (the source pane's clipboard controls live on the
 * frame's subbar), so the group could only hold undo/redo - the tab row's
 * quick access already draws those, and a second pair read as a duplicate
 * (M-3/F4). A group is dropped rather than left holding a repeated command.
 */
import { useCallback, useMemo } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Redo2,
  Rows3,
  Search,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { OfficeRibbon, type OfficeRibbonProps } from "../../ribbon";
import type { RibbonGroup, RibbonIcon, RibbonItem, RibbonTab } from "../../ribbon/types";
import { CodeBlockToolbar } from "./code-block";
import { buildMarkdownGroupItems } from "./toolbar/build-items";
import { useMarkdownEditorToolbarState, useMarkdownToolbarActions } from "./toolbar/use-markdown-toolbar-state";
import type { MarkdownToolbarState } from "./toolbar/types";

/** i18next keys for the Markdown ribbon's own labels (see MISSING KEYS list). */
export const MARKDOWN_RIBBON_KEYS = {
  label: "office.markdown.ribbon.label",
  home: "office.markdown.ribbon.tabs.home",
  insert: "office.markdown.ribbon.tabs.insert",
  table: "office.markdown.ribbon.tabs.table",
  code: "office.markdown.ribbon.tabs.code",
  paragraph: "office.markdown.ribbon.groups.paragraph",
  tableGroup: "office.markdown.ribbon.groups.table",
  tableAddRowBefore: "office.markdown.ribbon.table.addRowBefore",
  tableAddRowAfter: "office.markdown.ribbon.table.addRowAfter",
  tableAddColumnBefore: "office.markdown.ribbon.table.addColumnBefore",
  tableAddColumnAfter: "office.markdown.ribbon.table.addColumnAfter",
  tableDeleteRow: "office.markdown.ribbon.table.deleteRow",
  tableDeleteColumn: "office.markdown.ribbon.table.deleteColumn",
  tableToggleHeaderRow: "office.markdown.ribbon.table.toggleHeaderRow",
  tableDelete: "office.markdown.ribbon.table.deleteTable",
} as const;

export interface MarkdownRibbonOptions {
  /** Read-only when false: every control is disabled, never hidden. */
  editable?: boolean;
  /** Pane visibility, owned by the caller (M6 mounts the panes). */
  outline?: boolean;
  frontmatter?: boolean;
  onOutlineChange?: (visible: boolean) => void;
  onFrontmatterChange?: (visible: boolean) => void;
  /** Absent until M5 wires asset upload; the control then renders disabled. */
  onInsertImage?: () => void;
  /** Trailing Find affordance; the caller owns the panel and the Ctrl+F key. */
  onFind?: () => void;
  /** Source <-> visual switch shown as the trailing segmented control (C11). */
  viewMode?: "visual" | "source";
  onViewModeChange?: (mode: "visual" | "source") => void;
  /** Persisted collapse scope, one per format. Defaults to "markdown". */
  scope?: string;
  layout?: OfficeRibbonProps["layout"];
  className?: string;
}

export interface MarkdownRibbonProps extends MarkdownRibbonOptions {
  /** The live M1 editor instance, or null before it mounts. */
  editor: Editor | null;
}

interface TableCommand {
  id: string;
  labelKey: string;
  icon: RibbonIcon;
  run: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean };
}

/** The contextual Table tab's commands (each one a TipTap table command). */
const TABLE_COMMANDS: readonly TableCommand[] = [
  { id: "table-add-row-before", labelKey: MARKDOWN_RIBBON_KEYS.tableAddRowBefore, icon: ArrowUpToLine, run: (chain) => chain.addRowBefore() },
  { id: "table-add-row-after", labelKey: MARKDOWN_RIBBON_KEYS.tableAddRowAfter, icon: ArrowDownToLine, run: (chain) => chain.addRowAfter() },
  { id: "table-add-column-before", labelKey: MARKDOWN_RIBBON_KEYS.tableAddColumnBefore, icon: ArrowLeftToLine, run: (chain) => chain.addColumnBefore() },
  { id: "table-add-column-after", labelKey: MARKDOWN_RIBBON_KEYS.tableAddColumnAfter, icon: ArrowRightToLine, run: (chain) => chain.addColumnAfter() },
  { id: "table-delete-row", labelKey: MARKDOWN_RIBBON_KEYS.tableDeleteRow, icon: Rows3, run: (chain) => chain.deleteRow() },
  { id: "table-delete-column", labelKey: MARKDOWN_RIBBON_KEYS.tableDeleteColumn, icon: Columns3, run: (chain) => chain.deleteColumn() },
  { id: "table-toggle-header-row", labelKey: MARKDOWN_RIBBON_KEYS.tableToggleHeaderRow, icon: Table2, run: (chain) => chain.toggleHeaderRow() },
  { id: "table-delete", labelKey: MARKDOWN_RIBBON_KEYS.tableDelete, icon: Trash2, run: (chain) => chain.deleteTable() },
];

/**
 * Build the Markdown ribbon tabs for the live editor. Pure of layout: the
 * ribbon decides sizing, collapse and the phone body.
 */
export function useMarkdownRibbonTabs(editor: Editor | null, options: MarkdownRibbonOptions = {}): RibbonTab[] {
  const {
    editable = true,
    outline = false,
    frontmatter = false,
    onOutlineChange,
    onFrontmatterChange,
    onInsertImage,
  } = options;
  const editorState = useMarkdownEditorToolbarState(editor);
  const actions = useMarkdownToolbarActions(editor, { insertImage: onInsertImage });
  const readOnly = !editable;
  const state = useMemo<MarkdownToolbarState>(
    () => ({ ...editorState, readOnly, outline, frontmatter }),
    [editorState, readOnly, outline, frontmatter],
  );
  const inTable = useEditorState({ editor, selector: ({ editor: live }) => live?.isActive("table") ?? false }) ?? false;
  // `state.codeBlock` (from the editor state) and the memoised `actions` are
  // both stable across renders; the deleted `useCodeBlockToolbar` returned a
  // fresh object each render, so keying the memo on it defeated the memo
  // entirely (RB-9; the hook went with RBF-6).
  const inCodeBlock = state.codeBlock !== null;

  return useMemo<RibbonTab[]>(() => {
    const itemsOf = (groupId: string): RibbonItem[] =>
      buildMarkdownGroupItems(groupId, { state, actions, onOutlineChange, onFrontmatterChange });

    const tableGroup: RibbonGroup = {
      id: "table",
      labelKey: MARKDOWN_RIBBON_KEYS.tableGroup,
      priority: 60,
      icon: Table2,
      items: TABLE_COMMANDS.map<RibbonItem>((command) => ({
        kind: "button",
        id: command.id,
        labelKey: command.labelKey,
        icon: command.icon,
        // R2/RB-3: exactly one large primary per group, including this
        // contextual tab; Delete table is the group's primary (as in Word).
        size: command.id === "table-delete" ? "large" : "icon",
        disabled: readOnly,
        onExecute: () => {
          if (editor) command.run(editor.chain().focus()).run();
        },
      })),
    };

    const codeGroup: RibbonGroup = {
      id: "codeBlock",
      labelKey: "office.markdown.code.language",
      priority: 60,
      items: [
        {
          kind: "custom",
          id: "codeBlock",
          labelKey: "office.markdown.code.language",
          width: 150,
          collapseAs: "icon",
          render: () => (
            <CodeBlockToolbar
              codeBlock={state.codeBlock}
              disabled={readOnly}
              onLanguageChange={actions.setCodeBlockLanguage}
              onCopy={actions.copyCodeBlock}
            />
          ),
        },
      ],
    };

    const home: RibbonTab = {
      id: "home",
      labelKey: MARKDOWN_RIBBON_KEYS.home,
      groups: [
        { id: "blockStyle", labelKey: MARKDOWN_RIBBON_KEYS.paragraph, priority: 50, items: itemsOf("blockStyle") },
        { id: "inline", labelKey: "office.markdown.toolbar.groups.inline", priority: 40, items: itemsOf("inline") },
        { id: "link", labelKey: "office.markdown.toolbar.groups.link", priority: 20, items: itemsOf("link") },
        { id: "lists", labelKey: "office.markdown.toolbar.groups.lists", priority: 30, items: itemsOf("lists") },
        { id: "view", labelKey: "office.markdown.toolbar.groups.view", priority: 0, items: itemsOf("view") },
      ],
    };
    const insert: RibbonTab = {
      id: "insert",
      labelKey: MARKDOWN_RIBBON_KEYS.insert,
      groups: [{ id: "insert", labelKey: "office.markdown.toolbar.groups.insert", priority: 10, items: itemsOf("insert") }],
    };
    const table: RibbonTab = {
      id: "table",
      labelKey: MARKDOWN_RIBBON_KEYS.table,
      contextual: { when: inTable, accent: "info" },
      groups: [tableGroup],
    };
    const code: RibbonTab = {
      id: "code",
      labelKey: MARKDOWN_RIBBON_KEYS.code,
      contextual: { when: inCodeBlock, accent: "warning" },
      groups: [codeGroup],
    };
    return [home, insert, table, code];
  }, [actions, editor, inCodeBlock, inTable, onFrontmatterChange, onOutlineChange, readOnly, state]);
}

/**
 * The Markdown ribbon surface: the shared ribbon loaded with the Markdown tabs,
 * the undo/redo quick access and the Find + Source | Visual trailing controls.
 */
export function MarkdownRibbon({
  editor,
  onFind,
  viewMode = "visual",
  onViewModeChange,
  scope = "markdown",
  layout,
  className,
  ...options
}: MarkdownRibbonProps) {
  const { t } = useTranslation();
  const tabs = useMarkdownRibbonTabs(editor, options);
  const readOnly = options.editable === false;

  const quickAccess = useMemo(
    () => (
      <>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.markdown.actions.undo")}
          disabled={readOnly}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.markdown.actions.redo")}
          disabled={readOnly}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 aria-hidden />
        </Button>
      </>
    ),
    [editor, readOnly, t],
  );

  const setViewMode = useCallback((mode: string) => onViewModeChange?.(mode as "visual" | "source"), [onViewModeChange]);

  const trailing = useMemo(
    () => (
      <>
        {onFind ? (
          <Tooltip>
            <TooltipTrigger
              render={<Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.common.chrome.find")} onClick={onFind} />}
            >
              <Search aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("office.common.chrome.find")}</TooltipContent>
          </Tooltip>
        ) : null}
        {onViewModeChange ? (
          <ToggleGroup value={[viewMode]} onValueChange={(value) => value[0] && setViewMode(value[0])} aria-label={t("office.markdown.view.label")} variant="toolbar">
            {/* The toolbar variant paints the selected segment with
                bg-surface-selected, which is visible in both themes; the
                default variant's bg-muted is near-invisible on the light band.
                The coarse-pointer sizes keep the 44px touch target without
                changing the desktop row. */}
            <ToggleGroupItem value="source" className="h-7 px-2 text-label pointer-coarse:min-h-11 pointer-coarse:min-w-11">{t("office.markdown.view.source")}</ToggleGroupItem>
            <ToggleGroupItem value="visual" className="h-7 px-2 text-label pointer-coarse:min-h-11 pointer-coarse:min-w-11">{t("office.markdown.view.wysiwyg")}</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </>
    ),
    [onFind, onViewModeChange, setViewMode, t, viewMode],
  );

  return (
    <OfficeRibbon
      tabs={tabs}
      scope={scope}
      quickAccess={quickAccess}
      trailing={trailing}
      layout={layout}
      labelKey={MARKDOWN_RIBBON_KEYS.label}
      className={className}
    />
  );
}
