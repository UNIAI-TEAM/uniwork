"use client";

// The image editing layer - mounted by the editing handle over the document
// surface. It owns the CONTEXTUAL inspector for the selected picture only
// (C9): the insert entry moved into the Insert tab's ribbon group
// (image/insert-image-group.tsx), so no command button floats over the canvas.
// Every action goes through the narrow DocxImageEditing port so the save path
// stays the single writer of the model.
import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { createDocxImageEditing, type DocxImageEditing } from "./docx-image-commands";
import { DocxImageInspector } from "./docx-image-inspector";
import type { DocxImageInfo } from "./docx-image-model";

export interface DocxImageLayerProps {
  editor: Editor | null;
  readOnly?: boolean;
}

function useDocxImageSelection(editing: DocxImageEditing | null): DocxImageInfo | null {
  const [info, setInfo] = useState<DocxImageInfo | null>(null);
  useEffect(() => {
    if (!editing) {
      setInfo(null);
      return undefined;
    }
    const sync = () => setInfo(editing.getSelected());
    sync();
    return editing.subscribe(sync);
  }, [editing]);
  return info;
}

export function DocxImageLayer({ editor, readOnly = false }: DocxImageLayerProps) {
  const editing = useMemo(() => (editor ? createDocxImageEditing(() => editor) : null), [editor]);
  const info = useDocxImageSelection(editing);
  if (!editing || !info) return null;
  return (
    <div
      className="pointer-events-none absolute inset-y-2 right-2 z-30 flex w-[min(18rem,calc(100%-1rem))] flex-col items-end gap-2"
      data-testid="docx-image-layer"
    >
      <div className="pointer-events-auto min-h-0 w-full overflow-y-auto" data-testid="docx-image-inspector-host">
        <DocxImageInspector info={info} editing={editing} readOnly={readOnly} />
      </div>
    </div>
  );
}
