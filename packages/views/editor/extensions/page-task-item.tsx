"use client";

import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { PatchedTaskItem } from "./list-item";

function PageTaskItemView({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const editable = useEditorState({ editor, selector: ({ editor: instance }) => instance.isEditable });
  return (
    <NodeViewWrapper data-checked={node.attrs.checked === true ? "true" : "false"} className="page-task-item">
      <span contentEditable={false} className="mt-1 shrink-0">
        <Checkbox checked={node.attrs.checked === true} disabled={!editable}
          aria-label={t("documents.page_ui.toggle_task", { task: node.textContent || t("documents.page_ui.blocks.taskList.label") })}
          onCheckedChange={(checked) => { if (editor.isEditable) updateAttributes({ checked }); }} />
      </span>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}

export const PageTaskItem = PatchedTaskItem.extend({
  // The renderer owns the actual list child; its React wrapper is a div.
  addNodeView() { return ReactNodeViewRenderer(PageTaskItemView, { as: "li" }); },
});
