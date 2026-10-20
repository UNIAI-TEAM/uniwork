import { useEffect, useState } from "react";
import type { ChatDocumentShareLevel } from "@uniwork/core/api/endpoints/chat";
import {
  CHAT_DOCUMENT_MAX_LABEL,
  CHAT_FILE_MAX_LABEL,
  isChatDocumentShareableFile,
  isChatDocumentTooLarge,
  isChatFileTooLarge,
  pickChatAcceptedFiles,
} from "./chat-file-accept";

/**
 * The document share level of the composer (UNI-1966): it lives next to the
 * staged files. UNI-2012 D1c: there is no "send as a plain file" choice any
 * more — an editor-format file always goes as a document with the level the
 * sender saw, and the level picker shows whenever one is staged, even beside
 * an image.
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
  const [shareChoice, setShareChoice] = useState<ChatDocumentShareLevel>("comment");
  // A room that cannot take document sends (can_send_document: false — no
  // permission, or a roster over the batch cap) keeps today's plain route.
  const showSharePicker =
    canSendDocument && hasDocumentSender && stagedFiles.some((file) => isChatDocumentShareableFile(file));
  useEffect(() => {
    // Back to the level default when the picker hides.
    if (!showSharePicker) setShareChoice("comment");
  }, [showSharePicker]);
  return { shareChoice, setShareChoice, showSharePicker };
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
 * (RFC-01), and only for editor-format files (UNI-2012 D1c): a mixed batch
 * splits — those by the document route, images and other files by the plain
 * route — and a hidden picker sends every file by the plain route, so no grant
 * is ever minted from a choice the user never made.
 */
export async function sendStagedFiles(
  files: File[],
  route: {
    shareChoice: ChatDocumentShareLevel;
    showSharePicker: boolean;
    onSendFile: (file: File) => void | Promise<void>;
    onSendDocument?: (file: File, shareLevel: ChatDocumentShareLevel) => void | Promise<void>;
  },
): Promise<void> {
  for (const file of files) {
    try {
      if (route.showSharePicker && route.onSendDocument && isChatDocumentShareableFile(file)) {
        await route.onSendDocument(file, route.shareChoice);
      } else {
        await route.onSendFile(file);
      }
    } catch {
      // The sender reports its own failure; the next file still goes.
    }
  }
}
