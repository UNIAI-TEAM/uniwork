import type { DesktopDraftStore } from "./drafts/store";
import { isLeaveSaveConfirmed } from "./leave";
import type { OpenedDocument, OpenedDocuments } from "./opened-documents";

/** Every document, including hidden tabs, must supply main-observed evidence.
 * No rows is the clean-document case; failed reads never count as clean. */
export function createDocumentLeaveEvidence(options: {
  readonly documents: OpenedDocuments;
  readonly store: DesktopDraftStore;
  readonly saveBusy: () => boolean;
}) {
  let requestedDocuments: readonly OpenedDocument[] | undefined;
  const confirm = async (choice: "keep" | "save" | "discard", issuedAt = 0): Promise<boolean> => {
    if (options.saveBusy()) return false;
    const documents = requestedDocuments ?? options.documents.all();
    const versions = documents.map((document) => document.checkpointVersion);
    try {
      for (const document of documents) {
        if (document.pendingCheckpoints > 0 || (document.checkpointFailed && choice !== "discard")) return false;
        const { base: _base, ...lookup } = document.identity;
        const rows = await options.store.list({ session: document.session, lookup });
        if (options.documents.context(document.documentId) !== document || document.pendingCheckpoints > 0 || (document.checkpointFailed && choice !== "discard")) return false;
        if (choice === "discard" && rows.length !== 0) return false;
        if (choice === "keep" && rows.length === 0 && document.checkpointVersion > document.savedCheckpointVersion) return false;
        if (choice === "save" && rows.length > 0 && document.savedCheckpointVersion < document.checkpointVersion) return false;
        if (choice === "save" && !isLeaveSaveConfirmed({ draftRows: rows.length, saveBusy: options.saveBusy(), lastConfirmedSaveAt: document.lastConfirmedSaveAt, issuedAt })) return false;
      }
      return !options.saveBusy() && options.documents.all().length === documents.length && documents.every((document, index) => options.documents.context(document.documentId) === document && document.pendingCheckpoints === 0 && document.checkpointVersion === versions[index]);
    } catch { return false; }
  };
  return {
    capture: () => { requestedDocuments = options.documents.all(); },
    confirmKeep: () => confirm("keep"),
    confirmSave: (issuedAt: number) => confirm("save", issuedAt),
    confirmDiscard: () => confirm("discard"),
  };
}
