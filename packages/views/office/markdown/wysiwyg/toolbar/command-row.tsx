"use client";

/**
 * The Markdown command row (M2): the C7 groups, in order, driven by the M1
 * editor.
 *
 * It is the COMMAND ROW content of the shared chrome (brief C7/C9), not a
 * second header and not a floating bar over the canvas. The row declares its
 * groups as data (`groups.ts`) and renders them with the shared ribbon's group
 * view, so adaptive collapse, overflow and the phone layout stay the chrome's
 * job; the chrome mount of the same groups lives in `chrome-tab.tsx`.
 *
 * Undo/redo (chrome quick access, C6), Save (shared save cluster, C2) and the
 * source <-> visual switch (chrome view control, C11) are deliberately not here.
 */
import { useMemo } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { RibbonGroupView } from "../../../ribbon/ribbon-group";
import type { RibbonGroup } from "../../../ribbon/types";
import { buildMarkdownGroupItems } from "./build-items";
import { MARKDOWN_TOOLBAR_GROUPS } from "./groups";
import { useMarkdownEditorToolbarState, useMarkdownToolbarActions } from "./use-markdown-toolbar-state";
import type { MarkdownToolbarState } from "./types";

export interface MarkdownCommandRowProps {
  /** The live M1 editor instance, or null before it mounts. */
  editor: Editor | null;
  /** Read-only when false: every control is disabled, never hidden. */
  editable?: boolean;
  /** Pane visibility, owned by the caller (M6 mounts the panes). */
  outline?: boolean;
  frontmatter?: boolean;
  onOutlineChange?: (visible: boolean) => void;
  onFrontmatterChange?: (visible: boolean) => void;
  /** Absent until M5 wires asset upload; the control then renders disabled. */
  onInsertImage?: () => void;
  /** Overrides the editor-derived state, for callers that own the toggles. */
  state?: Partial<MarkdownToolbarState>;
}

export function MarkdownCommandRow({
  editor,
  editable = true,
  outline = false,
  frontmatter = false,
  onOutlineChange,
  onFrontmatterChange,
  onInsertImage,
  state: stateOverride,
}: MarkdownCommandRowProps) {
  const { t } = useTranslation();
  const editorState = useMarkdownEditorToolbarState(editor);
  const actions = useMarkdownToolbarActions(editor, { insertImage: onInsertImage });
  const state = useMemo<MarkdownToolbarState>(
    () => ({ ...editorState, readOnly: !editable, outline, frontmatter, ...stateOverride }),
    [editorState, editable, outline, frontmatter, stateOverride],
  );

  const groups = useMemo<RibbonGroup[]>(
    () =>
      MARKDOWN_TOOLBAR_GROUPS.map((group) => ({
        id: group.id,
        labelKey: group.labelKey,
        priority: group.priority,
        items: buildMarkdownGroupItems(group.id, { state, actions, onOutlineChange, onFrontmatterChange }),
      })),
    [actions, onFrontmatterChange, onOutlineChange, state],
  );

  return (
    <div
      className="flex min-h-11 items-center gap-1"
      role="group"
      aria-label={t("office.markdown.toolbar.label")}
      data-testid="md-toolbar"
    >
      {groups.map((group) => (
        <RibbonGroupView key={group.id} group={group} stage={0} />
      ))}
    </div>
  );
}
