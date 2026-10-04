"use client";

// B9 (UNI-924): Insert ▸ Shapes group — the basic-shape gallery plus the
// format panel for the selected shape. Every mutation goes through the shared
// command runtime, so the group never touches the editor directly.
import { Shapes } from "lucide-react";
import { getI18n } from "react-i18next";
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
 * the same `insertDocxShape(kind, label)` calls the gallery makes. The label is
 * translated here (typed items carry i18n keys, not text) so the inserted
 * shape's `attrs.label` reads the localized name instead of the raw key. The
 * mounted group keeps the preview gallery and the format panel reachable.
 */
export function docxShapesRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { commands, readOnly, saving } = context;
  const blocked = readOnly || saving || !commands;
  const { t } = getI18n();
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
        onSelect: () => commands?.insertDocxShape(item.kind, t(item.labelKey)),
      })),
    },
    {
      kind: "custom",
      id: "insert-shapes-gallery",
      labelKey: "office.docx.shapes.galleryLabel",
      width: 96,
      render: () => <DocxShapesGroup {...context} />,
    },
  ];
}
