"use client";

/**
 * The same C7 groups, mounted in the SHARED chrome's command row.
 *
 * The chrome (`packages/views/office/common/chrome/`) owns the row: it measures
 * the groups, moves whole groups into its "»" and never wraps. This module only
 * supplies the tab and its groups in order, as `EditorChromeTab` data, and wires
 * each control to the M1 editor handle. It is not a second chrome.
 *
 * A `render` item (the block-style dropdown, the link popover) keeps its own
 * control in the row; if the chrome moves its group into "»", that menu shows
 * the item's label with `onSelect` - the chrome's documented fallback, since a
 * menu entry cannot host a popover.
 */
import { useMemo } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import type {
  EditorChromeCommandGroup,
  EditorChromeCommandItem,
  EditorChromeTab,
} from "../../../common/chrome";
import { RibbonItemView } from "../../../ribbon/ribbon-item";
import type { RibbonItem } from "../../../ribbon/types";
import { buildMarkdownGroupItems } from "./build-items";
import { MARKDOWN_TOOLBAR_GROUPS } from "./groups";
import { useMarkdownEditorToolbarState, useMarkdownToolbarActions } from "./use-markdown-toolbar-state";
import type { MarkdownToolbarState } from "./types";

/**
 * One ribbon item as a chrome command item.
 *
 * `onSelect` is only set for controls the row renders itself. The two `custom`
 * controls (the block-style dropdown, the link popover) cannot be rebuilt
 * inside a menu, so their "»" entry keeps the chrome's documented fallback: the
 * label, no action. That is honest - a menu entry must not silently apply a
 * style or drop a link - and the chrome warns about it in development only.
 */
function toChromeItem(item: RibbonItem, label: string): EditorChromeCommandItem {
  const Icon = item.icon;
  return {
    id: item.id,
    label,
    icon: Icon ? <Icon aria-hidden /> : undefined,
    render: <RibbonItemView item={item} size="icon" stage={0} inPanel={false} />,
    pressed: item.kind === "toggle" ? item.pressed : undefined,
    disabled: item.disabled,
    onSelect: "onExecute" in item ? item.onExecute : undefined,
  };
}

export interface MarkdownToolbarChromeOptions {
  editable?: boolean;
  outline?: boolean;
  frontmatter?: boolean;
  onOutlineChange?: (visible: boolean) => void;
  onFrontmatterChange?: (visible: boolean) => void;
  onInsertImage?: () => void;
  state?: Partial<MarkdownToolbarState>;
}

/**
 * The Markdown command row as one chrome tab. Undo/redo stay the chrome's
 * quick access (C6) and Save stays in the shared cluster (C2): neither is here.
 */
export function useMarkdownToolbarChromeTab(
  editor: Editor | null,
  options: MarkdownToolbarChromeOptions = {},
): EditorChromeTab {
  const { t } = useTranslation();
  const { editable = true, outline = false, frontmatter = false, onOutlineChange, onFrontmatterChange, onInsertImage, state: stateOverride } = options;
  const editorState = useMarkdownEditorToolbarState(editor);
  const actions = useMarkdownToolbarActions(editor, { insertImage: onInsertImage });
  const state = useMemo<MarkdownToolbarState>(
    () => ({ ...editorState, readOnly: !editable, outline, frontmatter, ...stateOverride }),
    [editorState, editable, outline, frontmatter, stateOverride],
  );

  const groups = useMemo<EditorChromeCommandGroup[]>(
    () =>
      MARKDOWN_TOOLBAR_GROUPS.map((group) => ({
        id: group.id,
        label: t(group.labelKey),
        items: buildMarkdownGroupItems(group.id, { state, actions, onOutlineChange, onFrontmatterChange }).map((item) =>
          toChromeItem(item, t(item.labelKey)),
        ),
      })),
    [actions, onFrontmatterChange, onOutlineChange, state, t],
  );

  return useMemo(
    () => ({ id: "markdown-home", label: t("office.markdown.toolbar.tab"), groups }),
    [groups, t],
  );
}
