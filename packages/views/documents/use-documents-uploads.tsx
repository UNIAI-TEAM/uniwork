"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentLimits } from "@uniwork/core/api/endpoints/config";
import type { FolderUploadTransport } from "@uniwork/core/documents/folder-upload";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { isMyFolder, type DocumentTreeNode } from "@uniwork/core/types/document";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { useFolderUpload } from "./folder-upload/use-folder-upload";
import { useDocumentFileUpload } from "./use-document-file-upload";
import { useDropUpload } from "./use-drop-upload";

/**
 * Every way into an upload on the Documents home, in one place: the file
 * dialog, folder upload (picker and drop, UNI-2052) and the drop zone. Files
 * and folders land in the open folder, or in My Folder at the root.
 */
export function useDocumentsUploads({
  wsId,
  limits,
  canUpload,
  parentId,
  folderDoc,
  folderTitle,
  tree,
  myFolderId,
  resolveRootParent,
  parentShared,
  onOpen,
  onOpenFolder,
  folderTransport,
}: {
  wsId: string;
  limits: DocumentLimits;
  /** The viewer may create here; the drop zone and every entry point hide otherwise. */
  canUpload: boolean;
  /** The open folder; null at the root and on screens that are not a folder. */
  parentId: string | null;
  folderDoc: Parameters<typeof isMyFolder>[0];
  /** The open folder's name as shown to people (My Folder's own label included). */
  folderTitle: string | undefined;
  tree: DocumentTreeNode[];
  myFolderId: string | null;
  resolveRootParent: () => Promise<string>;
  parentShared: boolean;
  onOpen: (documentId: string) => void;
  onOpenFolder: (folderId: string) => void;
  /** Injected by tests. */
  folderTransport?: FolderUploadTransport;
}): {
  openUpload: () => void;
  /** Present only when the server takes folder uploads and the viewer may create here. */
  openFolderUpload: (() => void) | undefined;
  zoneProps: ReturnType<typeof useDropUpload>["zoneProps"];
  dropActive: boolean;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const fileUpload = useDocumentFileUpload({
    wsId,
    parentId,
    limits,
    onOpen,
    description: t(parentId && !isMyFolder(folderDoc) ? "documents.upload.description_folder" : "documents.upload.description"),
    rootDestination: "my_folder",
    rootParentId: myFolderId,
    resolveRootParent,
    parentShared,
  });
  const folderUpload = useFolderUpload({
    wsId,
    enabled: canUpload,
    folderId: parentId,
    destinationName: parentId ? (folderTitle ?? "") : t("documents.home.my_folder.label"),
    tree,
    limits,
    myFolderId,
    resolveRootParent,
    parentShared,
    onOpenFolder,
    transport: folderTransport,
  });
  // The limits above are the defaults until GET /config answers; a folder
  // dropped meanwhile waits for it rather than being called unavailable.
  const configLoading = usePublicConfig({ enabled: canUpload }).isLoading;
  const drop = useDropUpload({
    enabled: canUpload,
    maxBytes: limits.upload_max_bytes,
    upload: fileUpload.uploadDroppedFile,
    onFolders: folderUpload.available ? folderUpload.addFolders : undefined,
    onFiles: folderUpload.available ? folderUpload.addFiles : undefined,
    foldersReady: !configLoading,
    maxFolderFiles: limits.folder_upload?.max_files,
    uploadExtensions: limits.upload_extensions,
  });

  return {
    openUpload: fileUpload.openUpload,
    openFolderUpload: folderUpload.available ? folderUpload.openPicker : undefined,
    zoneProps: drop.zoneProps,
    dropActive: drop.active,
    dialogs: (
      <>
        <DocumentUploadDialog
          {...fileUpload.dialogProps}
          // Two or more files go through the folder-upload fast path as one files-mode run (ADDENDUM 2);
          // without folder upload on the server the picker stays single-file.
          onPickMany={
            folderUpload.available
              ? (files) => {
                  fileUpload.dialogProps.onOpenChange(false);
                  folderUpload.addFiles(files);
                }
              : undefined
          }
        />
        {folderUpload.dialogs}
      </>
    ),
  };
}
