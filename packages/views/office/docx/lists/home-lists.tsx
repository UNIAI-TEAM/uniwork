"use client";

// B5 (UNI-924): the Home tab's list group. It pairs the list-style gallery
// with the multilevel menu; both drive commands/numbering.ts, which owns the
// pending numbering definitions and the body edits.
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { ListStyleGallery } from "./list-style-gallery";
import { MultilevelMenu } from "./multilevel-menu";

export function HomeListsGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
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
