"use client";

// B5 (UNI-924): the Home tab's list group. It pairs the list-style gallery
// with the multilevel menu; both drive commands/numbering.ts, which owns the
// pending numbering definitions and the body edits.
import { List, ListTree } from "lucide-react";
import type { RibbonItem } from "../../ribbon";
import { DOCX_LIST_MAX_LEVEL, listPresetsOf, type DocxListPreset } from "./list-numbering";
import { ListStyleGallery } from "./list-style-gallery";
import { MultilevelMenu } from "./multilevel-menu";
import type { DocxToolbarGroupContext } from "../toolbar/types";

/** The entry's accessible name: the group name plus the sample it draws. */
function presetLabelKey(entry: DocxListPreset): string {
  if (entry.group === "bullets") return "office.docx.lists.presetBullet";
  if (entry.group === "numbers") return "office.docx.lists.presetNumber";
  return "office.docx.lists.presetMultilevel";
}

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
 * Typed ribbon items for the list group (R7): the list-style gallery as a
 * `dropdown` (every preset of the three libraries, each row calling the same
 * `applyDocxListPreset` the legacy menu called) and the multilevel menu as a
 * second `dropdown` with the nine level rows plus level stepping and
 * restart/continue. The preset rows keep the existing i18n keys and variables.
 */
export function homeListsRibbonItems({ format, commands, readOnly, saving }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const blocked = readOnly || saving || !commands || !format;
  const list = format?.docxList ?? null;
  const inList = list !== null;

  const presetRows = (group: "bullets" | "numbers" | "multilevel") =>
    listPresetsOf(group).map((entry) => ({
      id: `docx-list-preset-${entry.id}`,
      labelKey: presetLabelKey(entry),
      onSelect: () => commands?.applyDocxListPreset(entry.id),
    }));

  const levelRows = Array.from({ length: DOCX_LIST_MAX_LEVEL + 1 }, (_, ilvl) => ({
    id: `docx-list-level-${ilvl}`,
    labelKey: "office.docx.lists.level",
    disabled: !inList,
    checked: inList && list.ilvl === ilvl,
    onSelect: () => commands?.setDocxListLevel(ilvl),
  }));

  return [
    {
      kind: "dropdown",
      id: "docx-list-gallery",
      labelKey: "office.docx.lists.gallery",
      icon: List,
      size: "small",
      disabled: blocked,
      menu: [...presetRows("bullets"), ...presetRows("numbers"), ...presetRows("multilevel")],
    },
    {
      kind: "dropdown",
      id: "docx-list-multilevel",
      labelKey: "office.docx.lists.multilevel",
      icon: ListTree,
      size: "small",
      disabled: blocked,
      menu: [
        ...levelRows,
        {
          id: "docx-list-level-increase",
          labelKey: "office.docx.lists.increaseLevel",
          disabled: !inList,
          onSelect: () => commands?.stepDocxListLevel(1),
        },
        {
          id: "docx-list-level-decrease",
          labelKey: "office.docx.lists.decreaseLevel",
          disabled: !inList,
          onSelect: () => commands?.stepDocxListLevel(-1),
        },
        {
          id: "docx-list-restart",
          labelKey: "office.docx.lists.restartNumbering",
          disabled: !inList,
          onSelect: () => commands?.restartDocxListNumbering(),
        },
        {
          id: "docx-list-continue",
          labelKey: "office.docx.lists.continueNumbering",
          disabled: !inList,
          onSelect: () => commands?.continueDocxListNumbering(),
        },
      ],
    },
  ];
}

/** Home > Lists: the typed items live on the registry entry; this component
 * stays exported for hosts that want the inline control. */
export const HomeListsGroup = Object.assign(HomeListsGroupView, {
  ribbonItems: homeListsRibbonItems,
});

