"use client";

import { memo } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { DocumentTypeIcon } from "../documents/document-type-icon";
import { ChatDocumentRequestAccess, documentMutedClass } from "./chat-document-actions";
import { useChatDocumentMenu, type ChatDocumentDesktopOpen } from "./chat-document-menu";
import { OWN_BUBBLE_CONTROL_REST } from "./chat-file-card";
import { ChatMessageActionsFrame, chatMessageActionsRailClass, ChatMessageTouchMore } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, CHAT_ROW_WASH, ChatThreadRepliesLink, chatBubbleShape } from "./chat-message-row";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import { senderNameClass } from "./sender-colors";
import type { ChatMessage } from "./chat-messages";

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
  /** Host wiring for "Chỉnh sửa trong UniWork Office"; absent (the UniChat shell, D7) → that entry hides. */
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
  // The document's own actions live in the message menu (UNI-2012 S7); the
  // dialogs they open mount beside the row, outside the menu.
  const menu = useChatDocumentMenu({ workspaceId, roomId, message, desktopOpen });
  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors duration-(--duration-standard) focus-visible:outline-offset-2",
        CHAT_ROW_WASH,
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "mt-2" : "mt-4",
        // A deep link jumped here: the row's brand wash, as the other rows'.
        highlighted && "before:bg-brand-subtle before:ring-1 before:ring-brand/25",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      {/* 36rem like the text row: the card (22rem) + bubble padding + the in-flow
          actions rail (sm+, ~124px) + the avatar need ~34rem, and the 26rem cap
          the file row uses left the card ~220-260px (UNI-1966 N-01/F-03). */}
      <div className={cn("flex max-w-[min(85%,36rem)] gap-2", isOwn && "flex-row-reverse")}>
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
        <ChatMessageActionsFrame
          message={message}
          isOwn={isOwn}
          canEdit={false}
          onReply={onReply}
          onReact={onReact}
          onToggleReaction={onToggleReaction}
          onThread={onThread}
          onPin={onPin}
          onCopy={onCopy}
          onDelete={onDelete}
          onCreateTask={onCreateTask}
          onLinkTask={onLinkTask}
          onFollowUp={onFollowUp}
          documentItems={menu.documentItems}
          className={cn(
            "flex min-w-0 flex-col gap-1 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
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
                <ChatDocumentCard workspaceId={workspaceId} message={message} isOwn={isOwn} />
              </div>
              {isOwn ? (
                // My time and ticks sit outside the brand bubble, where the own-meta tone is invisible: the wall chip.
                <ChatMessageMeta message={message} isOwn showTime onWall />
              ) : (
                <div className="px-1">
                  <ChatMessageMeta message={message} isOwn={false} showTime />
                </div>
              )}
              <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} onReact={onReact} />
              <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} nameContext={nameContext} />
              <MessageTaskCard workspaceId={workspaceId} messageId={message.id} isOwn={isOwn} />
            </div>
          </div>
        </ChatMessageActionsFrame>
      </div>
      {menu.surfaces}
    </article>
  );
}

/**
 * The document message's body (UNI-1966, contract §5/§6.2). Three states:
 * missing/garbage block → a neutral file card (body filename, no actions);
 * viewer_has_access false → the locked card (nothing about the document);
 * otherwise the titled card with the viewer's level. The title opens the
 * document; every other action the block grants is in the message menu
 * (UNI-2012 S7). It never throws on drifted data.
 */
export function ChatDocumentCard({
  workspaceId,
  message,
  isOwn,
}: {
  workspaceId: string;
  message: ChatMessage;
  /** The bubble it sits on: text, badge and controls follow its palette. */
  isOwn: boolean;
}) {
  const { t } = useTranslation();
  const doc = message.document;
  const workspace = useOptionalWorkspace()?.workspace;
  const navigation = useNavigation();
  const textClass = isOwn ? "text-chat-bubble-own-foreground" : "text-foreground";
  const openDocument = doc
    ? () => {
        if (!workspace) return;
        navigation.push(paths.workspace(workspace.organization_slug, workspace.slug).document(doc.document_id));
      }
    : null;

  if (!doc) {
    // Neutral card for a missing or drifted block: the filename the body
    // carried, nothing else — no title, no actions.
    return <NeutralDocumentCard filename={message.body} textClass={textClass} />;
  }
  if (doc.viewer_has_access === false) {
    // The heading wraps (never truncates) and the action sits below it, so the
    // state stays readable in a narrow bubble; the sent/pending line replaces
    // the button in the same slot.
    return (
      <div className="flex w-72 max-w-full flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
            <LockKeyhole className="size-4" aria-hidden />
          </span>
          <p className={cn("min-w-0 flex-1 text-body font-medium", textClass)}>
            {t("chat.document_no_access")}
          </p>
        </div>
        <div className="min-w-0">
          <ChatDocumentRequestAccess workspaceId={workspaceId} documentId={doc.document_id} isOwn={isOwn} />
        </div>
      </div>
    );
  }

  const title = doc.title ?? message.body;
  const level = doc.viewer_level;

  return (
    // A fixed width (capped by the bubble) so a normal filename and the whole
    // secondary line fit instead of shrinking to the content's min width.
    <div className="flex w-[22rem] max-w-full flex-col">
      <div className="flex items-center gap-3">
        {/* The server omits `format` for a page document (no file), so no format reads as the page mark, as the picker's kind does. */}
        <DocumentTypeIcon format={doc.format || "page"} className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            title={title}
            aria-label={`${t("chat.document_open_in_documents")}: ${title}`}
            onClick={openDocument ?? undefined}
            className={cn(
              // truncate clips an outside outline: the ring is drawn inset, in the button's own padding, so it never covers the caption below.
              "pointer-coarse:min-h-11 -mx-1 -my-0.5 block w-[calc(100%+0.5rem)] truncate rounded-sm px-1 py-0.5 text-left text-body font-medium hover:underline focus-visible:-outline-offset-2",
              textClass,
              isOwn && "focus-visible:outline-chat-bubble-own-foreground",
            )}
          >
            {title}
          </button>
          <p className={cn("text-caption", documentMutedClass(isOwn))}>
            {doc.version_number !== undefined
              ? t("documents.file.version_row", { no: doc.version_number })
              : null}
            {doc.recipient_count !== undefined
              ? `${doc.version_number !== undefined ? " · " : ""}${t("chat.document_shared_with_count", { count: doc.recipient_count })}`
              : null}
          </p>
        </div>
        {level ? (
          <Badge variant="secondary" className={cn("shrink-0", isOwn && OWN_BUBBLE_CONTROL_REST)}>{t(`documents.share.level_${level}`)}
          </Badge>
        ) : null}
        {/* Touch has no hover bar: the same menu, one tap away (coarse pointers only). */}
        <ChatMessageTouchMore className="-mr-1" />
      </div>
    </div>
  );
}

/** The bare card for a missing or garbage `document` block: icon + filename. */
function NeutralDocumentCard({ filename, textClass }: { filename: string; textClass: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
        <DocumentTypeIcon format="file" decorative className="size-4" />
      </span>
      <p className={cn("min-w-0 flex-1 truncate text-body font-medium", textClass)}>
        {filename || t("chat.file_untitled")}
      </p>
    </div>
  );
}

/** One document message. Memoised like the file row. */
export const ChatDocumentMessageRow = memo(ChatDocumentMessageRowImpl);
