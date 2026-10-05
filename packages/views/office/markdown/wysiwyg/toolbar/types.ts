/**
 * Types for the Markdown WYSIWYG command row (M2).
 *
 * The command row is the shared chrome's command row, not a second header
 * (brief C7/C9): the Markdown editor contributes ONE tab whose groups are
 * declared here, in the fixed C7 order, and the chrome decides how they fit.
 * Nothing in this folder draws a floating control over the canvas.
 *
 * A control appears ONCE per tab. Undo/redo are the chrome's quick access in
 * the tab row (C6) and Save belongs to the shared save cluster (C2, UNI-930),
 * so neither is declared here.
 */

import type { CodeBlockInfo } from "../code-block";

/** The one block-style dropdown's choices: paragraph, H1-H6, quote, code. */
export type MarkdownBlockStyle =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "quote"
  | "code";

/** Inline marks with a Markdown representation in the shared extension set. */
export type MarkdownInlineMark = "bold" | "italic" | "strike" | "inlineCode";

export type MarkdownListKind = "bullet" | "ordered" | "task";

/** Group ids in the C7 order: block style, inline marks, link, lists, insert, view. */
export type MarkdownToolbarGroupId = "blockStyle" | "inline" | "link" | "lists" | "insert" | "view";

export type MarkdownToolbarControlId =
  | "blockStyle"
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "link"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "insertTable"
  | "insertImage"
  | "insertHr"
  | "insertDiagram"
  | "insertMath"
  | "codeBlock"
  | "viewOutline"
  | "viewFrontmatter";

/**
 * How a control renders. `custom` covers the two controls the ribbon's data
 * model does not express: the compact block-style dropdown and the link
 * popover. Every other control is a plain ribbon toggle or button.
 */
export type MarkdownToolbarControlKind = "toggle" | "button" | "custom";

/** One control, described without callbacks so the definition stays pure data. */
export interface MarkdownToolbarControlDefinition {
  id: MarkdownToolbarControlId;
  /** i18next key: the accessible name and the tooltip. */
  labelKey: string;
  kind: MarkdownToolbarControlKind;
  /** Display chord such as "Ctrl+B", appended to the tooltip. */
  shortcut?: string;
}

/** One command-row group, described without callbacks. */
export interface MarkdownToolbarGroupDefinition {
  id: MarkdownToolbarGroupId;
  /** i18next key: the group caption and its aria-label. */
  labelKey: string;
  /** Ribbon collapse order: the lowest priority folds into "»" first. */
  priority: number;
  controls: readonly MarkdownToolbarControlDefinition[];
}

/** The formula the cursor sits on (M4), or null when it is elsewhere. */
export interface MarkdownToolbarMathState {
  kind: "inline" | "block";
  expression: string;
}

/** Editor state the controls read to show active state. */
export interface MarkdownToolbarState {
  /** Read-only (no capability, or the editor is not editable). */
  readOnly: boolean;
  activeBlock: MarkdownBlockStyle;
  marks: Readonly<Record<MarkdownInlineMark, boolean>>;
  /** Current link under the cursor, or null. */
  link: { href: string; title: string | null } | null;
  lists: Readonly<Record<MarkdownListKind, boolean>>;
  /** Outline pane visible. */
  outline: boolean;
  /** Front-matter panel visible. */
  frontmatter: boolean;
  /** Formula under the cursor, for the math control's edit mode (M4). */
  math: MarkdownToolbarMathState | null;
  /** Code block under the cursor, for the contextual picker (M4); null hides it. */
  codeBlock: CodeBlockInfo | null;
}

/**
 * Everything a control can do. Callbacks only: the toolbar never sees bytes,
 * a host adapter or a transport, so Save stays on the coordinator path.
 */
export interface MarkdownToolbarActions {
  setBlockStyle(style: MarkdownBlockStyle): void;
  toggleMark(mark: MarkdownInlineMark): void;
  applyLink(href: string, title: string | null): void;
  removeLink(): void;
  toggleList(list: MarkdownListKind): void;
  insertTable(): void;
  /** Absent until the image task (M5) wires asset upload. */
  insertImage?: () => void;
  insertHorizontalRule(): void;
  /** Insert a fenced `mermaid` block with the starter template (M4). */
  insertDiagram(): void;
  /** Insert or edit a formula: `inline` or `block` (M4). */
  insertMath(kind: "inline" | "block", expression: string): void;
  /** Set the current code block's `language` attribute ("" clears it) (M4). */
  setCodeBlockLanguage(language: string): void;
  /** Copy the current code block's text; resolves true when it reached the clipboard (M4). */
  copyCodeBlock(): Promise<boolean>;
}
