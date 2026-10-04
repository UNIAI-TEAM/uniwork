"use client";

// B9 (UNI-924): Insert ▸ Shapes group — the basic-shape gallery plus the
// format panel for the selected shape. Every mutation goes through the shared
// command runtime, so the group never touches the editor directly.
import { Shapes } from "lucide-react";
import type { RibbonItem } from "../../ribbon";
import { DOCX_SHAPE_GALLERY } from "./docx-shape-model";
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

/**
 * Typed ribbon items (R7): the primary Shape command is a large dropdown over
 * the same `insertDocxShape(kind, label)` calls the gallery makes; the format
 * panel for the selected shape stays one custom item (its inputs and select do
 * not fit the typed model). No command is dropped - the mounted component keeps
 * the preview gallery.
 */
export function docxShapesRibbonItems({ format, commands, readOnly, saving }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const blocked = readOnly || saving || !commands;
  return [
    {
      kind: "dropdown",
      id: "insert-shapes",
      labelKey: "office.docx.shapes.insert",
      icon: Shapes,
      size: "large",
      disabled: blocked,
      menu: DOCX_SHAPE_GALLERY.map((item) => ({
        id: `insert-shape-${item.kind}`,
        labelKey: item.labelKey,
        onSelect: () => commands?.insertDocxShape(item.kind, item.labelKey),
      })),
    },
    {
      kind: "custom",
      id: "insert-shapes-format",
      labelKey: "office.docx.shapes.format",
      render: () => (
        <DocxShapePanel
          disabled={blocked}
          shape={format?.docxShape ?? null}
          onEdit={(edit) => {
            commands?.applyDocxShapeEdit(edit);
          }}
        />
      ),
    },
  ];
}
