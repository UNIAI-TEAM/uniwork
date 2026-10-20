"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { patchDocument } from "@uniwork/core/api/endpoints/documents";
import { useDocumentTree, useMoveDocument } from "@uniwork/core/documents/hooks-collections";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { Document } from "@uniwork/core/types/document";
import type { FileMeta, OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { documentErrorMessage } from "../../documents/document-error-message";
import { FolderNameDialog } from "../../documents/folder-name-dialog";
import { FolderPickerDialog } from "../../documents/folder-picker-dialog";
import { loadMoveRevision, myFolderFirst } from "../../documents/document-tree-model";
import type { FirstSaveNamer } from "./docs-frame-session-model";
import { describeLocation, FirstSaveLocation } from "./first-save-location";

/**
 * UNI-1847 (SAVE-01), D1: the file a never-saved blank Office document stores.
 * The server's blank create names it `untitled.<ext>` (one of the six module
 * formats) at file version 1; any later version, any other name and a document
 * with no file (UniNote page, source attachment) is already its own document
 * and never prompts.
 */
export function hasUntitledVersionOneFile(doc: Pick<Document, "file"> | null | undefined): boolean {
  const file = doc?.file;
  if (!file || file.version !== 1) return false;
  return /^untitled\.(docx|xlsx|pptx|pdf|md|html)$/i.test(file.filename);
}

/**
 * The extension the document's stored file carries (the module's own when the
 * file names none): it builds the name the frame displays and, stripped from a
 * default title, the name the dialog proposes (S01-V5).
 */
function fileExtension(doc: Document | null | undefined, mod: OfficeModule): string {
  return doc?.file?.filename.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? `.${officeModuleSpec(mod).extension}`;
}

/** `useFirstSaveNaming`'s return: the session's `firstSave` namer plus the dialog it owns. */
export interface FirstSaveNaming extends FirstSaveNamer {
  /** The naming dialog to render inside the frame host. */
  dialog: React.ReactNode;
  /** True while the dialog is open (a save is waiting on a name). */
  open: boolean;
}

/**
 * The page's "name this document" step of a first Office save. `namer` is the
 * `firstSave` option of `useDocsFrameSession`: the session adds "nothing saved
 * this session yet" and `viewOnly`; this hook owns the untitled/version-1 check,
 * the dialog, the title PATCH and the frame's rename notice. One dialog serves
 * every concurrent ask (a frame Ctrl+S racing a header Save). UNI-1960: the dialog
 * also shows where the document will live and lets the person pick another folder;
 * the move runs after the title is written, and a refused move keeps the dialog open.
 */
export function useFirstSaveNaming({
  document: doc,
  module,
  wsId,
  onNamed,
}: {
  document: Document | null | undefined;
  module: OfficeModule;
  wsId: string;
  /** The frame learns its new display name (`file.renamed`). */
  onNamed?: (file: FileMeta) => void;
}): FirstSaveNaming {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Latest values for the callbacks that outlive the render they were made in.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const latest = useRef({ doc, module, wsId, onNamed, target });
  latest.current = { doc, module, wsId, onNamed, target };
  // The document whose title was written this session (another blank prompts again): the stored
  // filename stays `untitled.<ext>` (FileService keeps its own name), so only this can tell.
  const named = useRef<string | null>(null);
  const pending = useRef<((named: boolean) => void)[]>([]);
  const [open, setOpen] = useState(false);
  const [initialTitle, setInitialTitle] = useState("");
  // A successful submit also fires onOpenChange(false): it must not read as a cancel.
  const namedThisClose = useRef(false);
  // The title already written for a document: a retry after a refused move must not write it again.
  const written = useRef<{ id: string; title: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tree = useDocumentTree(wsId, undefined, { enabled: open });
  const move = useMoveDocument(wsId);

  const settle = (namedNow: boolean) => {
    const asks = pending.current;
    pending.current = [];
    setOpen(false);
    for (const ask of asks) ask(namedNow);
  };

  const writeTitle = async (docId: string, ws: string, title: string) => {
    const revision = await loadMoveRevision(queryClient, ws, docId).catch(() => null);
    if (!revision) throw new Error("the document revision could not be read");
    const updated = await patchDocument(docId, { revision, title });
    if (!updated) throw new Error("the document rename was refused");
    written.current = { id: docId, title };
    // The title changes everywhere the document is listed or opened.
    queryClient.setQueryData(documentKeys.detail(ws, docId), updated);
    await queryClient.invalidateQueries({ queryKey: documentKeys.workspace(ws) });
  };

  const submit = async (title: string): Promise<boolean | void> => {
    const { doc: current, wsId: ws, module: mod, onNamed: notify, target: picked } = latest.current;
    if (!current) throw new Error("the document is not loaded");
    setMoveError(null);
    setBusy(true);
    try {
      if (written.current?.id !== current.id || written.current.title !== title) {
        await writeTitle(current.id, ws, title);
      }
      if (picked !== undefined && picked !== (current.parent_id ?? null)) {
        try {
          const revision = await loadMoveRevision(queryClient, ws, current.id);
          if (!revision) throw new Error("the document revision could not be read");
          await move.mutateAsync({ documentId: current.id, parent_id: picked, revision });
        } catch (failure) {
          // The name stays written and in the field: the person retries or cancels.
          setMoveError(documentErrorMessage(failure, t, "documents.tree.move_failed"));
          return false;
        }
      }
    } finally {
      setBusy(false);
    }
    namedThisClose.current = true;
    named.current = current.id;
    // The stored filename never follows the title: the frame's display name is
    // the title with the module's own extension, so its bar and recents read it.
    notify?.({ fileId: current.id, name: `${title}${fileExtension(current, mod)}` });
    return true;
  };

  const namer: FirstSaveNamer = {
    needsName: () => named.current !== latest.current.doc?.id && hasUntitledVersionOneFile(latest.current.doc),
    ask: () =>
      new Promise<boolean>((resolve) => {
        pending.current.push(resolve);
        if (pending.current.length === 1) {
          const { doc: current, module: mod } = latest.current;
          // A default title carries the format's extension; the name the user saves does
          // not, so the dialog proposes it stripped (S01-V5). Any other suffix stays.
          const ext = fileExtension(current, mod);
          const title = current?.title ?? "";
          setInitialTitle(title.toLowerCase().endsWith(ext.toLowerCase()) ? title.slice(0, -ext.length) : title);
          setTarget(undefined);
          setMoveError(null);
          setOpen(true);
        }
      }),
  };

  const chosen = target === undefined ? (doc?.parent_id ?? null) : target;
  const location = describeLocation(
    tree.data?.documents,
    chosen,
    target === undefined ? (doc?.breadcrumbs ?? []) : [],
    t,
  );

  const dialog = (
    <FolderNameDialog
      open={open}
      onOpenChange={(next) => { if (!next) settle(namedThisClose.current); namedThisClose.current = false; }}
      mode="rename"
      title={t("documents.detail.first_save.title")}
      description={t("documents.detail.first_save.hint")}
      submitLabel={t("documents.detail.first_save.submit")}
      initialName={initialTitle}
      selectAllOnOpen
      kind={doc?.kind ?? "file"}
      onSubmit={submit}
      error={moveError}
      data-testid="first-save-name-dialog"
    >
      <FirstSaveLocation
        label={location.label}
        myFolder={location.myFolder}
        disabled={busy}
        onChange={() => setPickerOpen(true)}
      />
      <FolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t("documents.detail.first_save.picker_title")}
        description={t("documents.detail.first_save.picker_description")}
        submitLabel={t("documents.detail.first_save.picker_submit")}
        tree={myFolderFirst(tree.data?.documents ?? [])}
        initialFolderId={chosen}
        currentFolderId={chosen}
        movingId={doc?.id ?? null}
        pending={false}
        error={null}
        onSubmit={(folderId) => {
          setTarget(folderId);
          setMoveError(null);
          setPickerOpen(false);
        }}
      />
    </FolderNameDialog>
  );

  return { ...namer, dialog, open };
}
