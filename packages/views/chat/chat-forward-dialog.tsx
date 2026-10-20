"use client";

import { Check, Forward, Hash, House, Lock } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRooms, useForwardChatMessage } from "@uniwork/core/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { identityTint } from "../people/identity-tint";
import {
  CHAT_DIALOG_BODY_CLASS,
  CHAT_DIALOG_CLASS,
  CHAT_DIALOG_WIDTH,
  CHAT_FIELD_TEXTAREA_CLASS,
  CHAT_LABEL_CLASS,
  CHAT_SECTION_LABEL_CLASS,
} from "./chat-dialog-look";
import { chatErrorMessage } from "./chat-error-message";
import { initialsOf, roomInitialsOf } from "./chat-initials";
import type { ChatMessage } from "./chat-messages";
import { replyPreviewLabel } from "./chat-reply-quote";
import { ChatRoomPhoto } from "./chat-room-mark";
import { foldedIncludes } from "./chat-search-fold";
import { WorkspaceMemberSearchField } from "./workspace-member-picker";

/** The server's cap per forward (maxChatForwardTargets). */
const MAX_FORWARD_TARGETS = 10;

/** A room as the picker names it: the person for a DM, "# name" for a public channel. */
function roomTitle(room: ChatRoomRecord): string {
  if (room.kind === "dm") return room.peer_display_name?.trim() || room.peer_email?.trim() || room.name;
  if (room.kind === "channel" && room.visibility !== "private" && !room.is_default) return `# ${room.name}`;
  return room.name;
}

/** The face the conversation list draws, at the pickers' 36px. */
function RoomFace({ room, title }: { room: ChatRoomRecord; title: string }) {
  if (room.kind === "dm") {
    const peer = room.peer_user_id ?? room.id;
    return (
      <ActorAvatar
        name={title}
        initials={initialsOf(title)}
        size="fluid"
        className={cn("size-9 font-display text-caption font-bold", tintSolidClass[identityTint(peer)])}
      />
    );
  }
  const glyph =
    room.kind === "workspace" || room.is_default ? (
      <House />
    ) : room.kind === "channel" ? (
      room.visibility === "private" ? <Lock /> : <Hash />
    ) : (
      roomInitialsOf(room.name)
    );
  return (
    <ChatRoomPhoto src={room.avatar_url} className="size-9 rounded-[10px]">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[10px] font-display text-caption font-bold [&_svg]:size-4.5",
          room.kind === "workspace" || room.is_default ? tintSolidClass.blue : tintSolidClass[identityTint(room.id)],
        )}
      >
        {glyph}
      </span>
    </ChatRoomPhoto>
  );
}

/**
 * "Chuyển tiếp": pick up to ten conversations the caller is in, add an
 * optional note, send. The copy names the original author only. It is all or
 * nothing on the server, so a refusal names the room that stopped it.
 */
export function ChatForwardDialog({
  workspaceId,
  message,
  onOpenChange,
}: {
  workspaceId: string;
  /** The message to forward; null closes the dialog. */
  message: ChatMessage | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const forward = useForwardChatMessage(workspaceId);
  const { data: rooms = [], isLoading } = useChatRooms(message ? workspaceId : "");

  const sorted = useMemo(
    () =>
      [...rooms].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")).map((room) => ({
        room,
        title: roomTitle(room),
      })),
    [rooms],
  );
  const visible = useMemo(
    () => (query.trim() ? sorted.filter((entry) => foldedIncludes(entry.title, query.trim())) : sorted),
    [query, sorted],
  );
  const titleOf = (roomId: string) => sorted.find((entry) => entry.room.id === roomId)?.title ?? "";
  const full = picked.length >= MAX_FORWARD_TARGETS;

  const close = () => {
    if (forward.isPending) return;
    setQuery("");
    setPicked([]);
    setComment("");
    onOpenChange(false);
  };

  const toggle = (roomId: string) =>
    setPicked((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : prev.length >= MAX_FORWARD_TARGETS ? prev : [...prev, roomId],
    );

  const submit = () => {
    if (!message || picked.length === 0 || forward.isPending) return;
    void forward
      .mutateAsync({ messageId: message.id, target_room_ids: picked, comment: comment.trim() || undefined })
      .then((copies) => {
        const names = copies.map((copy) => titleOf(copy.room_id)).filter(Boolean);
        const shown = names.slice(0, 3).join(", ");
        toast.success(
          names.length > 3
            ? t("chat.forward.done_more", { names: shown, count: names.length - 3 })
            : t("chat.forward.done", { names: shown }),
        );
        close();
      })
      .catch((err: unknown) => {
        const refused = err instanceof ApiError && err.code === "chat_forward_target_refused" ? err.fields?.room_id : undefined;
        if (typeof refused === "string" && titleOf(refused)) {
          toast.error(t("chat.forward.target_refused", { name: titleOf(refused) }));
        } else if (err instanceof ApiError && (err.code === "chat_forward_disabled" || err.code === "chat_forward_kind")) {
          toast.error(t(err.code === "chat_forward_disabled" ? "chat.forward.disabled" : "chat.forward.kind_refused"));
        } else {
          toast.error(chatErrorMessage(err, t, t("chat.forward.failed")));
        }
      });
  };

  return (
    <Dialog open={message != null} onOpenChange={(open) => (open ? undefined : close())}>
      <FormDialogContent size="md" className={`${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.form}`}>
        <FormDialogHeader title={t("chat.forward.title")} description={t("chat.forward.description")} />
        <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-5`}>
          {message ? (
            // What goes, quoted the way the delete confirmation quotes it.
            <blockquote className="flex min-w-0 items-start gap-2 rounded-[10px] border-l-3 border-brand/30 bg-muted px-3 py-2 text-body text-foreground">
              <Forward className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <span className="line-clamp-2 [overflow-wrap:anywhere]">
                {replyPreviewLabel(message, {
                  voice: t("chat.voice_message"),
                  file: t("chat.file_untitled"),
                  media: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") },
                })}
              </span>
            </blockquote>
          ) : null}
          <WorkspaceMemberSearchField
            id={`${listId}-search`}
            label={t("chat.forward.search_label")}
            query={query}
            onQueryChange={setQuery}
            onSubmit={() => {
              const only = visible.length === 1 ? visible[0] : undefined;
              if (only && !picked.includes(only.room.id)) toggle(only.room.id);
            }}
            placeholder={t("chat.forward.search_placeholder")}
          />

          <div className="space-y-2">
            <p id={`${listId}-heading`} className={CHAT_SECTION_LABEL_CLASS}>
              {query.trim() ? t("chat.forward.results") : t("chat.forward.recent")}
            </p>
            {isLoading ? (
              <p role="status" className="text-caption text-muted-foreground">
                {t("chat.forward.loading")}
              </p>
            ) : visible.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {query.trim() ? t("chat.forward.empty") : t("chat.forward.none")}
              </p>
            ) : (
              <ul
                aria-labelledby={`${listId}-heading`}
                className="max-h-72 divide-y divide-border overflow-y-auto rounded-[14px] border border-border"
              >
                {visible.map(({ room, title }) => {
                  const checked = picked.includes(room.id);
                  const blocked = !checked && full;
                  return (
                    <li key={room.id} className="first:*:rounded-t-[14px] last:*:rounded-b-[14px]">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-disabled={blocked || undefined}
                        onClick={() => {
                          if (!blocked) toggle(room.id);
                        }}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-surface-hover",
                          checked && "bg-brand-subtle/40",
                          blocked && "cursor-default opacity-50 hover:bg-transparent",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-5.5 shrink-0 items-center justify-center rounded-[7px] border-2",
                            checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-surface text-transparent",
                          )}
                        >
                          <Check strokeWidth={3.2} className="size-3.5" />
                        </span>
                        <RoomFace room={room} title={title} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-lg font-medium text-foreground">{title}</span>
                          <span className="block truncate text-label text-muted-foreground">
                            {room.kind === "dm"
                              ? (room.peer_email ?? "")
                              : room.kind === "group"
                                ? t("chat.forward.kind_group", { count: room.member_user_ids.length + 1 })
                                : room.kind === "workspace" || room.is_default
                                  ? t("chat.forward.kind_workspace")
                                  : t("chat.forward.kind_channel", { count: room.member_count })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {full ? <p className="text-caption text-muted-foreground">{t("chat.forward.limit_hint", { max: MAX_FORWARD_TARGETS })}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${listId}-comment`} className={CHAT_LABEL_CLASS}>
              {t("chat.forward.comment_label")}
            </Label>
            <Textarea
              id={`${listId}-comment`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t("chat.forward.comment_placeholder")}
              maxLength={4000}
              rows={2}
              className={`${CHAT_FIELD_TEXTAREA_CLASS} min-h-11`}
            />
          </div>
        </FormDialogBody>
        <FormDialogFooter
          onCancel={close}
          cancelVariant="secondary"
          submitLabel={
            picked.length > 0 ? t("chat.forward.submit", { count: picked.length }) : t("chat.forward.submit_empty")
          }
          submittingLabel={t("chat.forward.sending")}
          submitting={forward.isPending}
          submitDisabled={picked.length === 0}
          onSubmit={submit}
          leading={
            picked.length > 0
              ? t("chat.forward.selected", { count: picked.length, max: MAX_FORWARD_TARGETS })
              : t("chat.forward.pick_hint")
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
