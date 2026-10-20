import { useEffect, useState } from "react";
import type { ChatDocumentShareLevel } from "@uniwork/core/api/endpoints/chat";
import type { ChatComposerShareChoice } from "./chat-composer-share-level";
import {
  CHAT_DOCUMENT_MAX_LABEL,
  CHAT_FILE_MAX_LABEL,
  isChatAcceptedFile,
  isChatDocumentShareableFile,
  isChatDocumentTooLarge,
  isChatFileTooLarge,
  pickChatAcceptedFiles,
} from "./chat-file-accept";

/**
 * The document share choice of the composer (UNI-1966): it lives next to the
 * staged files; "file" sends the plain attachment route exactly as before.
 */
export function useComposerDocumentShare({
  stagedFiles,
  canSendDocument,
  hasDocumentSender,
}: {
  stagedFiles: File[];
  canSendDocument: boolean;
  hasDocumentSender: boolean;
}) {
  const [shareChoice, setShareChoice] = useState<ChatComposerShareChoice>("comment");
  const showSharePicker =
    canSendDocument &&
    hasDocumentSender &&
    stagedFiles.length > 0 &&
    stagedFiles.every((file) => isChatDocumentShareableFile(file));
  // "Chỉ gửi tệp" is offered only while every staged file could also go by
  // the plain route — a document-only kind or a file over the 25 MB chat
  // ceiling would only earn a 415/413 there (RFC-02).
  const sharePickerAllowsFile =
    showSharePicker &&
    stagedFiles.every((file) => isChatAcceptedFile(file) && !isChatFileTooLarge(file));
  useEffect(() => {
    // Back to the level default when the picker hides, and off "file" when
    // the plain route stops being a real choice (a stale "file" choice
    // would otherwise route a document-only kind to the refusing route).
    if (!showSharePicker || (!sharePickerAllowsFile && shareChoice === "file")) {
      setShareChoice("comment");
    }
  }, [showSharePicker, sharePickerAllowsFile, shareChoice]);
  return { shareChoice, setShareChoice, showSharePicker, sharePickerAllowsFile };
}

/**
 * Sorts dropped / pasted / picked files into what can be staged and what the
 * composer must complain about: unsupported kinds, and files over the ceiling
 * of the route they would take.
 */
export function classifyComposerFiles(files: File[], canSendDocument: boolean) {
  const accepted = pickChatAcceptedFiles(files, canSendDocument);
  const tooLarge = (file: File) =>
    isChatDocumentShareableFile(file) && canSendDocument ? isChatDocumentTooLarge(file) : isChatFileTooLarge(file);
  const ready = accepted.filter((file) => !tooLarge(file));
  return {
    ready,
    unsupported: accepted.length < files.length,
    tooLarge: ready.length < accepted.length,
    // A dropped shareable file still names its own ceiling.
    maxLabel: accepted.some((file) => isChatDocumentShareableFile(file) && canSendDocument && isChatDocumentTooLarge(file))
      ? CHAT_DOCUMENT_MAX_LABEL
      : CHAT_FILE_MAX_LABEL,
  };
}

/**
 * One upload at a time: the server holds each file in memory while it checks
 * it, and a handful of large ones at once can exhaust the pod. The document
 * route runs only from the level the user saw and chose on a visible picker
 * (RFC-01): a mixed batch or a hidden picker sends every file by the plain
 * route, so no grant is ever minted from a choice the user never made.
 */
export async function sendStagedFiles(
  files: File[],
  route: {
    shareChoice: ChatComposerShareChoice;
    showSharePicker: boolean;
    onSendFile: (file: File) => void | Promise<void>;
    onSendDocument?: (file: File, shareLevel: ChatDocumentShareLevel) => void | Promise<void>;
  },
): Promise<void> {
  for (const file of files) {
    try {
      if (route.showSharePicker && route.shareChoice !== "file" && route.onSendDocument) {
        await route.onSendDocument(file, route.shareChoice);
      } else {
        await route.onSendFile(file);
      }
    } catch {
      // The sender reports its own failure; the next file still goes.
    }
  }
}
