"use client";

// B5 (UNI-924): the Home tab's list group. It pairs the list-style gallery
// with the multilevel menu; both drive commands/numbering.ts, which owns the
// pending numbering definitions and the body edits.
import { List, ListTree } from "lucide-react";
import type { RibbonItem } from "../../ribbon";
import { ListStyleGallery } from "./list-style-gallery";
import { MultilevelMenu } from "./multilevel-menu";
import type { DocxToolbarGroupContext } from "../toolbar/types";

function HomeListsGroupView({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const list = format?.docxList ?? null;
  const blocked = readOnly || saving || !commands || !format;

  return (
    <>
      <ListStyleGallery disabled={blocked} onPick={(id) => commands?.applyDocxListPreset(id)} />
      <MultilevelMenu
        list={list}
        disabled={blocked}
        onSetLevel={(ilvl) => commands?.setDocxListLevel(ilvl)}
        onStepLevel={(direction) => commands?.stepDocxListLevel(direction)}
        onRestart={() => commands?.restartDocxListNumbering()}
        onContinue={() => commands?.continueDocxListNumbering()}
      />
    </>
  );
}

/**
 * Typed ribbon items for the list group (R7): the list-style gallery and the
 * multilevel menu mount as `custom` items - the seam's documented escape hatch,
 * exactly like the paragraph spacing picker. They cannot be typed `dropdown`s
 * because `RibbonMenuEntry` renders `t(labelKey)` with no interpolation, so the
 * `{{glyph}}`/`{{sample}}`/`{{level}}` labels, the per-level preview, the
 * section headers/separators and the row icons would be lost (review F2/F11).
 * Every command stays reachable with the same checked and disabled state the
 * legacy menus carried: `applyDocxListPreset`, `setDocxListLevel`,
 * `stepDocxListLevel(+/-1)` and `restart/continueDocxListNumbering`.
 */
export function homeListsRibbonItems({ format, commands, readOnly, saving }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const list = format?.docxList ?? null;
  const blocked = readOnly || saving || !commands || !format;

  return [
    {
      kind: "custom",
      id: "docx-list-gallery",
      labelKey: "office.docx.lists.gallery",
      icon: List,
      size: "small",
      disabled: blocked,
      width: 32,
      render: () => <ListStyleGallery disabled={blocked} onPick={(id) => commands?.applyDocxListPreset(id)} />,
    },
    {
      kind: "custom",
      id: "docx-list-multilevel",
      labelKey: "office.docx.lists.multilevel",
      icon: ListTree,
      size: "small",
      disabled: blocked,
      width: 32,
      render: () => (
        <MultilevelMenu
          list={list}
          disabled={blocked}
          onSetLevel={(ilvl) => commands?.setDocxListLevel(ilvl)}
          onStepLevel={(direction) => commands?.stepDocxListLevel(direction)}
          onRestart={() => commands?.restartDocxListNumbering()}
          onContinue={() => commands?.continueDocxListNumbering()}
        />
      ),
    },
  ];
}

/** Home > Lists: the typed items live on the registry entry; this component
 * stays exported for hosts that want the inline control. */
export const HomeListsGroup = Object.assign(HomeListsGroupView, {
  ribbonItems: homeListsRibbonItems,
});
