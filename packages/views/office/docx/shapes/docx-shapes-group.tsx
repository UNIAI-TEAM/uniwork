"use client";

// B9 (UNI-924): Insert ▸ Shapes group — the basic-shape gallery plus the
// format panel for the selected shape. Every mutation goes through the shared
// command runtime, so the group never touches the editor directly.
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxShapeGallery } from "./docx-shape-gallery";
import { DocxShapePanel } from "./docx-shape-panel";

export function DocxShapesGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const blocked = readOnly || saving || !commands;
  return (
    <>
      <DocxShapeGallery
        disabled={blocked}
        onInsert={(kind, label) => {
          commands?.insertDocxShape(kind, label);
        }}
      />
      <DocxShapePanel
        disabled={blocked}
        shape={format?.docxShape ?? null}
        onEdit={(edit) => {
          commands?.applyDocxShapeEdit(edit);
        }}
      />
    </>
  );
}
