"use client";

// The image editing layer — mounted by the editing handle over the document
// surface. It owns the insert entry and the inspector panel; every action goes
// through the narrow DocxImageEditing port so the save path stays the single
// writer of the model.
import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { createDocxImageEditing, type DocxImageEditing } from "./docx-image-commands";
import { DocxImageInsert } from "./docx-image-insert";
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
  if (!editing) return null;
  return (
    <div
      className="pointer-events-none absolute inset-y-2 right-2 z-30 flex w-[min(18rem,calc(100%-1rem))] flex-col items-end gap-2"
      data-testid="docx-image-layer"
    >
      <div className="pointer-events-auto">
        <DocxImageInsert editing={editing} readOnly={readOnly} />
      </div>
      {info ? (
        <div className="pointer-events-auto min-h-0 w-full overflow-y-auto" data-testid="docx-image-inspector-host">
          <DocxImageInspector info={info} editing={editing} readOnly={readOnly} />
        </div>
      ) : null}
    </div>
  );
}
