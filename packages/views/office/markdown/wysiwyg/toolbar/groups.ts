/**
 * The Markdown toolbar groups as pure data (M2).
 *
 * One list, in the brief's fixed C7 order, each control declared ONCE:
 *
 *   block style (paragraph / H1-H6 / quote / code, one compact dropdown)
 *   inline marks (bold / italic / strike / inline code)
 *   link (add / edit / remove popover)
 *   lists (bullet / ordered / task)
 *   insert (table / image / horizontal rule)
 *   view (outline / front-matter toggles)
 *
 * Deliberately absent: undo/redo (the ribbon's quick-access slot in the tab
 * row, C6) and Save (the shared save cluster, C2 / UNI-930). The source <->
 * WYSIWYG switch is the ribbon's trailing view control, not a command here.
 *
 * `priority` is the ribbon's collapse order: the LOWEST value folds into "»"
 * first, so the reading/writing commands a user reaches for most stay in the
 * row longest and the pane toggles go first.
 */
import type { MarkdownBlockStyle, MarkdownToolbarGroupDefinition } from "./types";

/** Block styles in menu order; the first six are the heading levels. */
export const MARKDOWN_BLOCK_STYLES: readonly MarkdownBlockStyle[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "quote",
  "code",
];

/** The one compact block-style dropdown, then marks, link, lists, insert, view. */
export const MARKDOWN_TOOLBAR_GROUPS: readonly MarkdownToolbarGroupDefinition[] = [
  {
    id: "blockStyle",
    labelKey: "office.markdown.toolbar.groups.blockStyle",
    priority: 50,
    controls: [{ id: "blockStyle", labelKey: "office.markdown.wysiwyg.blockStyle", kind: "custom" }],
  },
  {
    id: "inline",
    labelKey: "office.markdown.toolbar.groups.inline",
    priority: 40,
    controls: [
      { id: "bold", labelKey: "office.markdown.wysiwyg.bold", kind: "toggle", shortcut: "Ctrl+B" },
      { id: "italic", labelKey: "office.markdown.wysiwyg.italic", kind: "toggle", shortcut: "Ctrl+I" },
      { id: "strike", labelKey: "office.markdown.wysiwyg.strike", kind: "toggle", shortcut: "Ctrl+Shift+S" },
      { id: "inlineCode", labelKey: "office.markdown.wysiwyg.inlineCode", kind: "toggle", shortcut: "Ctrl+E" },
    ],
  },
  {
    id: "link",
    labelKey: "office.markdown.toolbar.groups.link",
    priority: 20,
    controls: [{ id: "link", labelKey: "office.markdown.wysiwyg.link", kind: "custom" }],
  },
  {
    id: "lists",
    labelKey: "office.markdown.toolbar.groups.lists",
    priority: 30,
    controls: [
      { id: "bulletList", labelKey: "office.markdown.wysiwyg.bulletList", kind: "toggle" },
      { id: "orderedList", labelKey: "office.markdown.wysiwyg.orderedList", kind: "toggle" },
      { id: "taskList", labelKey: "office.markdown.wysiwyg.taskList", kind: "toggle" },
    ],
  },
  {
    id: "insert",
    labelKey: "office.markdown.toolbar.groups.insert",
    priority: 10,
    controls: [
      { id: "insertTable", labelKey: "office.markdown.wysiwyg.insertTable", kind: "button" },
      { id: "insertImage", labelKey: "office.markdown.wysiwyg.insertImage", kind: "button" },
      { id: "insertHr", labelKey: "office.markdown.wysiwyg.insertHr", kind: "button" },
      // M4: the two insertable rich blocks.
      { id: "insertDiagram", labelKey: "office.markdown.diagram.label", kind: "button" },
      { id: "insertMath", labelKey: "office.markdown.math.blockLabel", kind: "custom" },
      // M4: the code-block language picker + copy are CONTEXTUAL - they render
      // only while the cursor is inside a fence (the control null-renders
      // otherwise). Declaring them here, once, is what mounts them in the
      // shared ribbon (as the Insert group item and the contextual Code tab);
      // a contextual control the data model forgot would be dead code.
      { id: "codeBlock", labelKey: "office.markdown.code.language", kind: "custom" },
    ],
  },
  {
    id: "view",
    labelKey: "office.markdown.toolbar.groups.view",
    priority: 0,
    controls: [
      { id: "viewOutline", labelKey: "office.markdown.wysiwyg.viewOutline", kind: "toggle" },
      { id: "viewFrontmatter", labelKey: "office.markdown.wysiwyg.viewFrontmatter", kind: "toggle" },
    ],
  },
];

/** The heading level a block style stands for, or null for the other styles. */
export function headingLevelOf(style: MarkdownBlockStyle): number | null {
  const match = /^heading([1-6])$/.exec(style);
  return match ? Number(match[1]) : null;
}

/** The block style a cursor position stands for. Unknown levels fall back to
 * paragraph: the schema accepts H1-H6, so a level the menu cannot name must
 * still read as something rather than as a blank control. */
export function blockStyleOf(level: number | null | undefined): MarkdownBlockStyle {
  if (level === null || level === undefined) return "paragraph";
  const style = `heading${level}` as MarkdownBlockStyle;
  return MARKDOWN_BLOCK_STYLES.includes(style) ? style : "paragraph";
}
