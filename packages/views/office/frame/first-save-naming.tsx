"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { patchDocument } from "@uniwork/core/api/endpoints/documents";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { Document } from "@uniwork/core/types/document";
import type { FileMeta, OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { FolderNameDialog } from "../../documents/folder-name-dialog";
import { loadMoveRevision } from "../../documents/document-tree-model";
import type { FirstSaveNamer } from "./docs-frame-session-model";

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
 * every concurrent ask (a frame Ctrl+S racing a header Save).
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
  const latest = useRef({ doc, module, wsId, onNamed });
  latest.current = { doc, module, wsId, onNamed };
  // The document whose title was written this session (another blank prompts again): the stored
  // filename stays `untitled.<ext>` (FileService keeps its own name), so only this can tell.
  const named = useRef<string | null>(null);
  const pending = useRef<((named: boolean) => void)[]>([]);
  const [open, setOpen] = useState(false);
  const [initialTitle, setInitialTitle] = useState("");
  // A successful submit also fires onOpenChange(false): it must not read as a cancel.
  const namedThisClose = useRef(false);

  const settle = (namedNow: boolean) => {
    const asks = pending.current;
    pending.current = [];
    setOpen(false);
    for (const ask of asks) ask(namedNow);
  };

  const submit = async (title: string): Promise<boolean | void> => {
    const { doc: current, wsId: ws, module: mod, onNamed: notify } = latest.current;
    if (!current) throw new Error("the document is not loaded");
    const revision = await loadMoveRevision(queryClient, ws, current.id).catch(() => null);
    if (!revision) throw new Error("the document revision could not be read");
    const updated = await patchDocument(current.id, { revision, title });
    if (!updated) throw new Error("the document rename was refused");
    namedThisClose.current = true;
    // The title changes everywhere the document is listed or opened.
    queryClient.setQueryData(documentKeys.detail(ws, current.id), updated);
    await queryClient.invalidateQueries({ queryKey: documentKeys.workspace(ws) });
    named.current = current.id;
    // The stored filename never follows the title: the frame's display name is
    // the title with the module's own extension, so its bar and recents read it.
    const filename = current.file?.filename ?? "";
    const ext = filename.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? `.${officeModuleSpec(mod).extension}`;
    notify?.({ fileId: current.id, name: `${title}${ext}` });
    return true;
  };

  const namer: FirstSaveNamer = {
    needsName: () => named.current !== latest.current.doc?.id && hasUntitledVersionOneFile(latest.current.doc),
    ask: () =>
      new Promise<boolean>((resolve) => {
        pending.current.push(resolve);
        if (pending.current.length === 1) {
          setInitialTitle(latest.current.doc?.title ?? "");
          setOpen(true);
        }
      }),
  };

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
      data-testid="first-save-name-dialog"
    />
  );

  return { ...namer, dialog, open };
}
