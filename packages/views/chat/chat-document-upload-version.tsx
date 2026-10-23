"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode, errorFields } from "@uniwork/core/api";
import { chatKeys } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { useDocumentVersionUpload } from "../documents/use-document-version-upload";
import { CHAT_DIALOG_CLASS, CHAT_DIALOG_WIDTH } from "./chat-dialog-look";
import { chatDocumentVersionMessage, isDocumentLocked } from "./chat-document-actions";

// The upload dialog's own form stands in for FormDialogBody: p-0 content like
// FormDialogContent, the gutters on the form, the footer bleeding to the edges.
const UPLOAD_DIALOG_CLASS = `${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.narrow} gap-0 p-0 [&_form]:gap-4 [&_form]:px-6 [&_form]:pt-5 [&_form]:pb-1 [&_[data-slot=dialog-footer]]:-mx-6`;

/**
 * "Tải lên phiên bản mới" from a chat document card (UNI-2012 S6): the
 * document page's own writer (chunked, `edit_lock_id`, 423) with the room
 * named, so the server also writes the `document_version` line into this room
 * (contract §4.4). Mounted on the first ask from the card's menu, outside the
 * menu, and kept mounted so closing the menu never drops an upload in flight;
 * each later ask (`request`) opens the dialog again.
 */
export function ChatDocumentUploadVersion({
  workspaceId,
  roomId,
  documentId,
  revision,
  request,
  onOpenDocument,
}: {
  workspaceId: string;
  roomId: string;
  documentId: string;
  /** The card's `revision`: the base the commit must beat. */
  revision: string;
  /** Bumped by every menu ask; each new value opens the dialog. */
  request: number;
  /** "Mở trang tài liệu" for the reader's own hold in another window; absent hides it. */
  onOpenDocument?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // The version line is its own message; this card's `revision` is the base
  // of the next commit, so the timeline re-reads it or a second upload from
  // the card would answer 409.
  const refreshRoom = () => void queryClient.invalidateQueries({ queryKey: chatKeys.roomMessages(workspaceId, roomId) });
  const upload = useDocumentVersionUpload({
    wsId: workspaceId,
    documentId,
    revision,
    chatRoomId: roomId,
    describeError: (err) => chatDocumentVersionMessage(err, t),
    errorAction: (err) =>
      onOpenDocument && isDocumentLocked(err) && errorFields(err)?.held_by_me === true ? (
        <Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11" onClick={onOpenDocument}>
          {t("chat.document_menu.open_document_page")}
        </Button>
      ) : null,
    dialogClassName: UPLOAD_DIALOG_CLASS,
    onCommitted: () => {
      refreshRoom();
      toast.success(t("chat.document_menu.version_uploaded"));
    },
    onFailed: (err) => {
      // A stale revision: the card re-reads the current one (and the
      // document_version line the winning commit wrote arrives with it, RFC-04).
      if (errorCode(err) === "document_version_conflict") refreshRoom();
    },
  });
  // Only a new ask opens the dialog, never a re-render.
  const openRef = useRef(upload.open);
  openRef.current = upload.open;
  useEffect(() => {
    if (request > 0) openRef.current();
  }, [request]);
  return <>{upload.dialog}</>;
}
