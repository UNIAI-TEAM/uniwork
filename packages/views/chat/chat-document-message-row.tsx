"use client";

import { memo, useEffect, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode } from "@uniwork/core/api";
import { chatKeys } from "@uniwork/core/chat";
import { useDocument, useDocumentLimits, useUploadDocumentFile } from "@uniwork/core/documents/hooks";
import { useCommitDocumentVersion } from "@uniwork/core/documents/hooks-versions";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import type { Document } from "@uniwork/core/types/document";
import { paths } from "@uniwork/core/paths";
import { createSafeId } from "@uniwork/core/utils";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import type { FrameDesktopOpenProps } from "../office";
import { DesktopOpenAction } from "../office/desktop-open-action";
import { DocumentTypeIcon } from "../documents/document-type-icon";
import { ShareDialog } from "../documents/share-dialog";
import { documentUploadValidationMessage } from "../documents/document-error-message";
import { DocumentUploadDialog } from "../documents/document-upload-dialog";
import {
  CHAT_DOCUMENT_ACCESS_REQUESTS_ENABLED,
  ChatDocumentRequestAccess,
  chatDocumentVersionError,
} from "./chat-document-actions";
import { ChatMessageHoverActions, chatMessageActionsRailClass } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, ChatThreadRepliesLink, chatBubbleShape } from "./chat-message-row";
import { useMessageActionsReveal } from "./use-message-actions-reveal";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import { senderNameClass } from "./sender-colors";
import type { ChatMessage } from "./chat-messages";

/** The host-bound "Mở bằng UniWork Office" wiring — the document page's own builder. */
export type ChatDocumentDesktopOpen = (
  document: Pick<Document, "id" | "organization_id" | "current_version">,
) => FrameDesktopOpenProps;

function ChatDocumentMessageRowImpl({
  workspaceId,
  roomId,
  message,
  senderLabel,
  senderAvatarUrl,
  isOwn,
  showSenderName,
  compactTop,
  showAvatar,
  nameContext = [],
  replyToMessage,
  desktopOpen,
  onReply,
  onReact,
  onToggleReaction,
  onJumpToMessage,
  onThread,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
  highlighted = false,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  senderLabel: string;
  senderAvatarUrl?: string;
  isOwn: boolean;
  showSenderName: boolean;
  compactTop: boolean;
  showAvatar: boolean;
  nameContext?: ChatNameContextEntry[];
  replyToMessage?: ChatMessage;
  /** Host wiring for "Mở bằng UniWork Office"; absent → that action hides. */
  desktopOpen?: ChatDocumentDesktopOpen;
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onThread?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
  /** A deep link jumped here: ring the row like the text row does. */
  highlighted?: boolean;
}) {
  const reveal = useMessageActionsReveal();
  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors duration-(--duration-standard) focus-visible:outline-offset-2",
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "mt-2" : "mt-4",
        highlighted && "bg-brand-subtle ring-2 ring-brand",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      <div className={cn("flex max-w-[min(85%,26rem)] gap-2", isOwn && "flex-row-reverse")}>
        {isOwn ? null : showAvatar ? (
          <span className="shrink-0">
            <ChatSenderAvatar
              userId={message.sender}
              name={senderLabel}
              avatarUrl={senderAvatarUrl}
              nameContext={nameContext}
            />
          </span>
        ) : (
          <span className="w-8 shrink-0" aria-hidden />
        )}
        <div
          ref={reveal.rootRef}
          {...reveal.bind}
          className={cn(
            "group/message relative flex min-w-0 flex-col gap-1 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
            isOwn ? "items-end" : "items-start",
          )}
        >
          {showSenderName && !isOwn ? (
            <p className={cn("px-1 text-caption font-semibold", senderNameClass(message.sender, isOwn))} aria-hidden>
              {senderLabel}
            </p>
          ) : null}
          <div className={chatMessageActionsRailClass(isOwn)}>
            <div className="flex min-w-0 flex-col gap-1">
              <div
                className={cn(
                  "max-w-full overflow-hidden px-3 py-2",
                  chatBubbleShape(isOwn, !compactTop),
                  isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
                )}
              >
                {replyToMessage ? (
                  <ChatReplyQuote
                    message={replyToMessage}
                    isOwn={isOwn}
                    onJump={onJumpToMessage}
                  />
                ) : null}
                <ChatDocumentCard
                  workspaceId={workspaceId}
                  roomId={roomId}
                  message={message}
                  desktopOpen={desktopOpen}
                />
              </div>
              <div className="px-1">
                <ChatMessageMeta message={message} isOwn={isOwn} showTime />
              </div>
              <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />
              <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} />
              <MessageTaskCard
                workspaceId={workspaceId}
                messageId={message.id}
                className={cn(isOwn && "items-end self-end")}
              />
            </div>
            <ChatMessageHoverActions
              message={message}
              isOwn={isOwn}
              onReply={onReply}
              onReact={onReact}
              onThread={onThread}
              onPin={onPin}
              onCopy={onCopy}
              onDelete={onDelete}
              onCreateTask={onCreateTask}
              onLinkTask={onLinkTask}
              onFollowUp={onFollowUp}
              canEdit={false}
              forceOpen={reveal.open}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The document message's body (UNI-1966, contract §5/§6.2). Three states:
 * missing/garbage block → a neutral file card (body filename, no actions);
 * viewer_has_access false → the locked card (nothing about the document);
 * otherwise the titled card with the viewer's level and only the actions the
 * block grants. It never throws on drifted data.
 */
export function ChatDocumentCard({
  workspaceId,
  roomId,
  message,
  desktopOpen,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  desktopOpen?: ChatDocumentDesktopOpen;
}) {
  const { t } = useTranslation();
  const doc = message.document;
  const workspace = useOptionalWorkspace()?.workspace;
  const navigation = useNavigation();
  const openDocument = doc
    ? () => {
        if (!workspace) return;
        navigation.push(paths.workspace(workspace.organization_slug, workspace.slug).document(doc.document_id));
      }
    : null;

  // "Mở bằng UniWork Office" exists only when the server granted it — the
  // block's fields are opt-in, so an absent flag is a hidden action, never
  // a shown one (RFC-03): a drifted row must not mint an office session
  // for a v0 or archived document.
  const desktop =
    desktopOpen && workspace && doc && doc.viewer_has_access === true && doc.can_open_in_app === true
      ? desktopOpen({
          id: doc.document_id,
          organization_id: workspace.organization_id,
          current_version: doc.version_number ?? 0,
        })
      : undefined;

  if (!doc) {
    // Neutral card for a missing or drifted block: the filename the body
    // carried, nothing else — no title, no actions.
    return <NeutralDocumentCard filename={message.body} />;
  }
  if (doc.viewer_has_access === false) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
          <LockKeyhole className="size-4" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
          {t("chat.document_no_access")}
        </p>
        {CHAT_DOCUMENT_ACCESS_REQUESTS_ENABLED ? (
          <ChatDocumentRequestAccess workspaceId={workspaceId} documentId={doc.document_id} />
        ) : null}
      </div>
    );
  }

  const title = doc.title ?? message.body;
  const level = doc.viewer_level;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <DocumentTypeIcon format={doc.format} className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            title={t("chat.document_open_in_documents")}
            aria-label={`${t("chat.document_open_in_documents")}: ${title}`}
            onClick={openDocument ?? undefined}
            className="pointer-coarse:min-h-11 block w-full truncate text-left text-body font-medium text-foreground hover:underline"
          >
            {title}
          </button>
          <p className="truncate text-caption text-muted-foreground">
            {doc.version_number !== undefined
              ? t("documents.file.version_row", { no: doc.version_number })
              : null}
            {doc.recipient_count !== undefined
              ? `${doc.version_number !== undefined ? " · " : ""}${t("chat.document_shared_with_count", { count: doc.recipient_count })}`
              : null}
          </p>
        </div>
        {level ? <Badge variant="secondary" className="shrink-0">{t(`documents.share.level_${level}`)}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {doc.viewer_can_manage ? (
          <ChatDocumentManageAccess workspaceId={workspaceId} documentId={doc.document_id} />
        ) : null}
        {doc.viewer_can_upload_version && doc.revision ? (
          <ChatDocumentUploadVersion
            workspaceId={workspaceId}
            roomId={roomId}
            documentId={doc.document_id}
            revision={doc.revision}
          />
        ) : null}
        {desktop ? (
          <DesktopOpenAction
            {...desktop}
            documentId={doc.document_id}
            placement="inline"
            operation={level === "edit" || level === "manage" ? "edit" : "view"}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The bare card for a missing or garbage `document` block: icon + filename. */
function NeutralDocumentCard({ filename }: { filename: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
        <DocumentTypeIcon format="file" decorative className="size-4" />
      </span>
      <p className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
        {filename || t("chat.file_untitled")}
      </p>
    </div>
  );
}

/**
 * "Quản lý quyền truy cập": opens the share dialog for this document. The
 * dialog needs the document object, so the detail query runs only from the
 * click — no fetch for every card on the timeline.
 */
function ChatDocumentManageAccess({
  workspaceId,
  documentId,
}: {
  workspaceId: string;
  documentId: string;
}) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  const detail = useDocument(workspaceId, documentId, { enabled: asked });
  // Each error toasts once — keyed on the error object so a second failure
  // toasts again — and the click resets the report before it re-asks.
  const reportedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (!detail.isError || detail.error === reportedErrorRef.current) return;
    reportedErrorRef.current = detail.error;
    setAsked(false);
    toast.error(t("chat.errors.internal"));
  }, [detail.isError, detail.error, t]);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:min-h-11"
        onClick={() => {
          // A new ask: the flag resets so a fresh failure toasts again and a
          // success opens the dialog (RFC-08).
          reportedErrorRef.current = null;
          setAsked(true);
          setOpen(true);
        }}
      >
        {t("chat.document_manage_access")}
      </Button>
      {detail.data ? (
        <ShareDialog open={open} onOpenChange={setOpen} wsId={workspaceId} doc={detail.data} />
      ) : null}
    </>
  );
}

/**
 * "Tải lên phiên bản mới": stage the bytes, then commit on the card's
 * `revision` with the room named — the server also writes the
 * `document_version` line into this room when it accepts the marker
 * (contract §4.4). One Idempotency-Key per user intent.
 */
function ChatDocumentUploadVersion({
  workspaceId,
  roomId,
  documentId,
  revision,
}: {
  workspaceId: string;
  roomId: string;
  documentId: string;
  /** The card's `revision`: the base the commit must beat. */
  revision: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const upload = useUploadDocumentFile(workspaceId, documentId);
  const commit = useCommitDocumentVersion(workspaceId, documentId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const limits = useDocumentLimits({ enabled: dialogOpen });
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const pending = upload.isPending || commit.isPending;

  const stageNewVersion = async (picked: File) => {
    const invalid = documentUploadValidationMessage(picked, limits.upload_max_bytes, t, i18n.language);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    idempotencyKey.current ??= createSafeId();
    let staged = false;
    try {
      const stagedFile = await upload.mutateAsync({
        file: picked,
        idempotencyKey: idempotencyKey.current,
      });
      staged = true;
      await commit.mutateAsync({
        upload_id: stagedFile.upload_id,
        base_revision: revision,
        chat_room_id: roomId,
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = null;
      setDialogOpen(false);
    } catch (err) {
      setError(
        chatDocumentVersionError(
          err,
          t,
          staged ? "documents.file.commit_failed" : "documents.file.upload_failed",
        ),
      );
      if (errorCode(err) === "document_version_conflict") {
        // The card's revision is stale: the room timeline refetches so the
        // card re-reads the current one (and the document_version line the
        // winning commit wrote arrives with it, RFC-04).
        void queryClient.invalidateQueries({ queryKey: chatKeys.roomMessages(workspaceId, roomId) });
      }
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:min-h-11"
        onClick={() => setDialogOpen(true)}
      >
        {t("documents.actions.upload_version")}
      </Button>
      <DocumentUploadDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next) {
            idempotencyKey.current = null;
            setError(null);
          }
          setDialogOpen(next);
        }}
        title={t("documents.upload.version_title")}
        description={t("documents.upload.version_description")}
        hint={t("documents.upload.size_hint", { max: formatDocumentSizeMB(limits.upload_max_bytes, i18n.language) })}
        pending={pending}
        error={error}
        showShareToggle={false}
        onSubmit={(picked) => void stageNewVersion(picked)}
        onPickFile={() => {
          // A different pick is a new intent: the key from a failed upload
          // must not be replayed against different bytes (RFC-08).
          idempotencyKey.current = null;
          setError(null);
        }}
      />
    </>
  );
}

/** One document message. Memoised like the file row. */
export const ChatDocumentMessageRow = memo(ChatDocumentMessageRowImpl);
