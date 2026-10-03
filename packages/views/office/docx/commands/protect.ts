// C3 (UNI-924): the protect command area. It owns the open document's
// protection state (seeded from the parse), the single pending protection edit
// and the snapshot channel that replays it onto the save session. The panel
// drives it; a save-transparent transaction marks the document dirty because
// protection lives outside the document.
import type { Editor } from "@tiptap/core";
import type { DocProtection, DocxAdapter, WriteProtection } from "@uniwork/office-engine/docx";
import {
  protectionEquals,
  protectionStateFromParsed,
  writeProtectionEquals,
  type DocxProtectionEdit,
  type DocxProtectionSnapshot,
} from "../protect/docx-protection";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxProtectionEdit, DocxProtectionSnapshot } from "../protect/docx-protection";

export interface DocxProtectFormatState {
  /** Effective protection state of the open document; null before open. */
  docxProtection: DocxProtectionSnapshot | null;
}

export interface DocxProtectCommands {
  /** Open hook: seed the document's own protection state from the parse. */
  seedDocxProtection(parsed: unknown): void;
  /** Snapshot channel: the pending edit, or undefined when none is pending. */
  snapshotDocxProtection(): DocxProtectionEdit | undefined;
  /** Draft restore: re-seed the pending edit. */
  restoreDocxProtection(edit: DocxProtectionEdit | undefined): void;
  /** Save hook: replay the pending edit onto a save session. */
  applyDocxProtectionEdit(adapter: Pick<DocxAdapter, "edit">, ref: string): void;
  /** Record a restriction change (null removes it); false = nothing to do. */
  setDocxProtection(protection: DocProtection | null): boolean;
  /** Record a password-to-modify change (null removes it); false = nothing to do. */
  setDocxWriteProtection(writeProtection: WriteProtection | null): boolean;
}

export function createProtectCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxProtectCommands, DocxProtectFormatState> {
  let ready = false;
  /** The document's own state — restore falls back to it. */
  let seeded: { protection: DocProtection | null; writeProtection: WriteProtection | null } = {
    protection: null,
    writeProtection: null,
  };
  /** Absent keys keep the document's own value; present keys replace it. */
  let edit: DocxProtectionEdit = {};

  /** A save-transparent transaction. The save coordinator only marks a
   * document dirty when a transaction carries a step, and protection lives
   * outside the document, so the block at the caret is re-marked with
   * identical attributes: steps.length > 0, no content change, not in the
   * undo history. */
  const touch = (): void => {
    const editor = context.getEditor();
    if (!editor || editor.isDestroyed || editor.state.doc.childCount === 0) return;
    const { state } = editor;
    const at = Math.min(
      state.doc.resolve(Math.min(state.selection.from, state.doc.content.size)).index(0),
      state.doc.childCount - 1,
    );
    let pos = 0;
    for (let i = 0; i < at; i += 1) pos += state.doc.child(i).nodeSize;
    const node = state.doc.child(at);
    const transaction = state.tr;
    transaction.setNodeMarkup(pos, undefined, { ...node.attrs }, node.marks);
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  };

  const effectiveProtection = (): DocProtection | null =>
    edit.protection !== undefined ? edit.protection : seeded.protection;
  const effectiveWriteProtection = (): WriteProtection | null =>
    edit.writeProtection !== undefined ? edit.writeProtection : seeded.writeProtection;

  return {
    commands: {
      seedDocxProtection: (parsed) => {
        seeded = protectionStateFromParsed(parsed);
        edit = {};
        ready = true;
      },
      snapshotDocxProtection: () =>
        edit.protection === undefined && edit.writeProtection === undefined
          ? undefined
          : { ...(edit.protection !== undefined ? { protection: edit.protection } : {}), ...(edit.writeProtection !== undefined ? { writeProtection: edit.writeProtection } : {}) },
      restoreDocxProtection: (next) => {
        edit = next ? { ...next } : {};
      },
      applyDocxProtectionEdit: (adapter, ref) => {
        if (edit.protection !== undefined) {
          adapter.edit(ref, { op: "set_protection", protection: edit.protection });
        }
        if (edit.writeProtection !== undefined) {
          adapter.edit(ref, { op: "set_write_protection", writeProtection: edit.writeProtection });
        }
      },
      setDocxProtection: (protection) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || !ready) return false;
        if (protectionEquals(effectiveProtection(), protection)) return false;
        edit = { ...edit, protection };
        touch();
        return true;
      },
      setDocxWriteProtection: (writeProtection) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || !ready) return false;
        if (writeProtectionEquals(effectiveWriteProtection(), writeProtection)) return false;
        edit = { ...edit, writeProtection };
        touch();
        return true;
      },
    },
    readState: (_editor: Editor | null) => ({
      docxProtection: ready
        ? {
            protection: effectiveProtection(),
            writeProtection: effectiveWriteProtection(),
            pending: edit.protection !== undefined || edit.writeProtection !== undefined,
          }
        : null,
    }),
  };
}
