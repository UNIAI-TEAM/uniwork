// B5 (UNI-924): the multilevel-list command area. It owns this session's
// pending numbering-part edits (new definitions + restart nums) and the
// snapshot channel that replays them onto the save session; the body edits
// (toggle / level / restart / continue) live in ../lists/list-actions.ts. Its
// toggleList overrides the base factory's — the runtime composes areas after
// base — so a new list allocates a real numeric numId plus the definition the
// save writes, instead of the legacy opaque id.
import type { Editor } from "@tiptap/core";
import type { DocxAdapter } from "@uniwork/office-engine/docx";
import {
  applyDocxListPreset,
  continueDocxListNumbering,
  readDocxListState,
  restartDocxListNumbering,
  setDocxListLevel,
  stepDocxListLevel,
  toggleDocxList,
} from "../lists/list-actions";
import {
  listDefsOf,
  listPresetById,
  overlayDefForNew,
  overlayDefForRestart,
  overlayListDef,
  type DocxListKind,
  type DocxListPresetId,
  type DocxListState,
  type DocxNumberingSnapshot,
} from "../lists/list-numbering";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxListState } from "../lists/list-numbering";
export type { DocxNumberingSnapshot } from "../lists/list-numbering";

export interface DocxNumberingFormatState {
  /** The caret's list context; null when the caret is not in a list item. */
  docxList: DocxListState | null;
}

export interface DocxNumberingCommands {
  /** Numbering-aware list toggle (overrides the base factory's): on allocates
   * a numeric numId with a definition, off returns items to paragraphs. */
  toggleList(kind: DocxListKind): void;
  /** Applies a list-style gallery preset definition to the selection. */
  applyDocxListPreset(presetId: DocxListPresetId): boolean;
  /** Sets the level (w:ilvl 0-8) of the selection's list items. */
  setDocxListLevel(ilvl: number): boolean;
  /** One level deeper or shallower for the selection's list items. */
  stepDocxListLevel(direction: 1 | -1): boolean;
  /** Restart numbering at the selection (new num + w:startOverride). */
  restartDocxListNumbering(): boolean;
  /** Continue the previous list's numbering at the selection. */
  continueDocxListNumbering(): boolean;
  /** Snapshot channel: the pending numbering edits, in apply order. */
  listDocxNumberingEdits(): DocxNumberingSnapshot;
  /** Draft restore: replace the pending edits and re-overlay their markers. */
  restoreDocxNumberingEdits(snapshot: DocxNumberingSnapshot | undefined): void;
  /** Save hook: replay the pending edits onto a save session. */
  applyDocxNumberingEdits(adapter: Pick<DocxAdapter, "edit">, ref: string): void;
}

function cloneSnapshot(snapshot: DocxNumberingSnapshot): DocxNumberingSnapshot {
  return {
    newDefs: snapshot.newDefs.map((def) => ({
      ...def,
      ...(def.levels ? { levels: def.levels.map((level) => ({ ...level })) } : {}),
    })),
    restartNums: snapshot.restartNums.map((restart) => ({ ...restart, startOverrides: { ...restart.startOverrides } })),
  };
}

export function createNumberingCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxNumberingCommands, DocxNumberingFormatState> {
  const pending: DocxNumberingSnapshot = { newDefs: [], restartNums: [] };

  return {
    commands: {
      toggleList: (kind) => {
        toggleDocxList(context.getEditor(), pending, kind);
      },
      applyDocxListPreset: (presetId) => {
        const preset = listPresetById(presetId);
        return preset ? applyDocxListPreset(context.getEditor(), pending, preset) : false;
      },
      setDocxListLevel: (ilvl) => setDocxListLevel(context.getEditor(), ilvl),
      stepDocxListLevel: (direction) => stepDocxListLevel(context.getEditor(), direction),
      restartDocxListNumbering: () => restartDocxListNumbering(context.getEditor(), pending),
      continueDocxListNumbering: () => continueDocxListNumbering(context.getEditor()),
      listDocxNumberingEdits: () => cloneSnapshot(pending),
      restoreDocxNumberingEdits: (snapshot) => {
        const next = snapshot ? cloneSnapshot(snapshot) : { newDefs: [], restartNums: [] };
        pending.newDefs = next.newDefs;
        pending.restartNums = next.restartNums;
        // Re-overlay the pending definitions: the storage belongs to this
        // editor instance, so a restored draft must rebuild its markers.
        const editor = context.getEditor();
        for (const def of pending.newDefs) overlayListDef(editor, overlayDefForNew(def));
        for (const restart of pending.restartNums) {
          const overlay = overlayDefForRestart(listDefsOf(editor), restart);
          if (overlay) overlayListDef(editor, overlay);
        }
      },
      applyDocxNumberingEdits: (adapter, ref) => {
        for (const def of pending.newDefs) adapter.edit(ref, { op: "insert_numbering_def", def });
        for (const restart of pending.restartNums) adapter.edit(ref, { op: "restart_numbering", restart });
      },
    },
    readState: (editor: Editor | null) => ({ docxList: readDocxListState(editor) }),
  };
}
