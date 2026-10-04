"use client";

/**
 * Turns the pure group definitions into the controls the shared chrome and the
 * shared ribbon render.
 *
 * One builder, two mounts: the ribbon body (`MarkdownCommandRow`) and the
 * chrome's command row (`markdownToolbarChromeTab`). Keeping the builder in
 * one place is what stops the two mounts from drifting into two rule sets.
 */
import {
  Bold,
  Code,
  Sigma,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  PanelTop,
  PanelTopOpen,
  SquareCode,
  Strikethrough,
  Table2,
  Workflow,
} from "lucide-react";
import type { RibbonIcon, RibbonItem } from "../../../ribbon/types";
import { CodeBlockToolbar } from "../code-block";
import { MathPopover } from "../math";
import { BlockStyleDropdown } from "./block-style-dropdown";
import { LinkPopover } from "./link-popover";
import { MARKDOWN_TOOLBAR_GROUPS } from "./groups";
import type { MarkdownToolbarActions, MarkdownToolbarState } from "./types";

const ICONS: Record<string, RibbonIcon> = {
  blockStyle: PanelTop,
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  inlineCode: Code,
  link: Link2,
  bulletList: List,
  orderedList: ListOrdered,
  taskList: ListChecks,
  insertTable: Table2,
  insertImage: ImageIcon,
  insertHr: Minus,
  insertDiagram: Workflow,
  insertMath: Sigma,
  codeBlock: SquareCode,
  viewOutline: ListTree,
  viewFrontmatter: PanelTopOpen,
};

/** True when a toggle reads as "on" for the given state. */
function pressedOf(id: string, state: MarkdownToolbarState): boolean {
  if (id === "bold") return state.marks.bold;
  if (id === "italic") return state.marks.italic;
  if (id === "strike") return state.marks.strike;
  if (id === "inlineCode") return state.marks.inlineCode;
  if (id === "bulletList") return state.lists.bullet;
  if (id === "orderedList") return state.lists.ordered;
  if (id === "taskList") return state.lists.task;
  if (id === "viewOutline") return state.outline;
  if (id === "viewFrontmatter") return state.frontmatter;
  return false;
}

/** Run one control's command against the actions. */
function executeControl(id: string, actions: MarkdownToolbarActions): void {
  if (id === "bold") actions.toggleMark("bold");
  else if (id === "italic") actions.toggleMark("italic");
  else if (id === "strike") actions.toggleMark("strike");
  else if (id === "inlineCode") actions.toggleMark("inlineCode");
  else if (id === "bulletList") actions.toggleList("bullet");
  else if (id === "orderedList") actions.toggleList("ordered");
  else if (id === "taskList") actions.toggleList("task");
  else if (id === "insertTable") actions.insertTable();
  else if (id === "insertImage") actions.insertImage?.();
  else if (id === "insertHr") actions.insertHorizontalRule();
  else if (id === "insertDiagram") actions.insertDiagram();
}

export interface BuildMarkdownToolbarItemsOptions {
  state: MarkdownToolbarState;
  actions: MarkdownToolbarActions;
  onOutlineChange?: (visible: boolean) => void;
  onFrontmatterChange?: (visible: boolean) => void;
}

/** The controls of one group, ready for the ribbon or the chrome. */
export function buildMarkdownGroupItems(
  groupId: string,
  { state, actions, onOutlineChange, onFrontmatterChange }: BuildMarkdownToolbarItemsOptions,
): RibbonItem[] {
  const group = MARKDOWN_TOOLBAR_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return group.controls.map<RibbonItem>((control) => {
    const icon = ICONS[control.id];
    const readOnly = state.readOnly;
    if (control.id === "blockStyle") {
      return {
        kind: "custom",
        id: control.id,
        labelKey: control.labelKey,
        icon,
        width: 140,
        render: () => (
          <BlockStyleDropdown value={state.activeBlock} disabled={readOnly} onChange={actions.setBlockStyle} />
        ),
      };
    }
    if (control.id === "link") {
      return {
        kind: "custom",
        id: control.id,
        labelKey: control.labelKey,
        icon,
        width: 40,
        render: () => (
          <LinkPopover link={state.link} disabled={readOnly} onApply={actions.applyLink} onRemove={actions.removeLink} />
        ),
      };
    }
    if (control.id === "codeBlock") {
      return {
        kind: "custom",
        id: control.id,
        labelKey: control.labelKey,
        icon,
        // The picker null-renders outside a fence, so it reserves no width
        // until the cursor is inside one (an always-on 150px would fold the
        // Insert group into "»" early for a control that is not there).
        width: state.codeBlock ? 150 : 0,
        collapseAs: "icon",
        render: () => (
          <CodeBlockToolbar
            codeBlock={state.codeBlock}
            disabled={readOnly}
            onLanguageChange={actions.setCodeBlockLanguage}
            onCopy={actions.copyCodeBlock}
          />
        ),
      };
    }
    if (control.id === "insertMath") {
      return {
        kind: "custom",
        id: control.id,
        labelKey: control.labelKey,
        icon,
        width: 40,
        render: () => (
          <MathPopover
            math={state.math}
            disabled={readOnly}
            onApply={(kind, expression) => actions.insertMath(kind, expression)}
          />
        ),
      };
    }
    if (control.kind === "toggle") {
      return {
        kind: "toggle",
        id: control.id,
        labelKey: control.labelKey,
        icon,
        size: "icon",
        pressed: pressedOf(control.id, state),
        shortcut: control.shortcut,
        disabled: readOnly,
        onExecute: () => {
          if (control.id === "viewOutline") onOutlineChange?.(!state.outline);
          else if (control.id === "viewFrontmatter") onFrontmatterChange?.(!state.frontmatter);
          else executeControl(control.id, actions);
        },
      };
    }
    const unavailable = control.id === "insertImage" && actions.insertImage === undefined;
    return {
      kind: "button",
      id: control.id,
      labelKey: control.labelKey,
      icon,
      size: "icon",
      disabled: readOnly || unavailable,
      tooltipKey: unavailable ? "office.markdown.toolbar.notAvailableYet" : undefined,
      onExecute: () => executeControl(control.id, actions),
    };
  });
}
