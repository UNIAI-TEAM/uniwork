"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast as sonner } from "sonner";
import { useChatRooms, useSendChatRoomMessage } from "@uniwork/core/chat";
import { useNotifications } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import type { Notification, Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintForegroundClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { chatPersonFaceClass } from "../chat/chat-person-card";
import { deserializeMessageBodyToComposerDraft } from "../chat/chat-mention-utils";
import { useNavigation } from "../navigation";
import { notificationTitleKey } from "../notifications/notification-title";
import { useWorkspace } from "./workspace-context";
import { initialsOf, workspaceTint } from "./workspace-rail";

/** The kinds that reach a person by name: a message to them, or one that mentions them. */
const TOAST_KINDS = new Set(["chat_dm", "chat_mentioned"]);
/** How long the card stays when nobody hovers it, focuses it or replies. */
const TOAST_MS = 8000;

/**
 * A conversation pane marks its `relative` message box with this attribute so
 * the card sits over the messages, as drawn; without one it sits at the top
 * right of the page.
 */
const ANCHOR = "[data-chat-toast-anchor]";

/**
 * A new DM or mention in a room of another workspace, as a card over the open
 * page: open the room, or answer it from the card. Its source is the unread
 * notification list the realtime sync refetches on notification.created (the
 * one user-scope event that crosses workspaces), so muted rooms stay quiet
 * (the server writes no row for them).
 */
export function WorkspaceChatToast() {
  const { workspace } = useWorkspace();
  const [anchor, setAnchor] = useState<Element | null>(null);
  const recent = useNotifications({ unreadOnly: true, limit: 20 });
  const { data: workspaces = [] } = useWorkspaces();
  /** Newest `updated_at ?? created_at` seen so far; null before the first load. */
  const newestSeen = useRef<number | null>(null);
  const [shown, setShown] = useState<Notification | null>(null);
  // Stable, so the card's timer does not restart on every refetch above it.
  const close = useCallback(() => setShown(null), []);

  useEffect(() => {
    const rows = recent.data?.notifications;
    if (!rows) return;
    const stamp = (n: (typeof rows)[number]) => Date.parse(n.updated_at ?? n.created_at) || 0;
    const before = newestSeen.current;
    newestSeen.current = Math.max(before ?? -Infinity, ...rows.map(stamp));
    // The first load is the backlog, not news.
    if (before === null) return;
    const fresh = rows
      .filter((n) => TOAST_KINDS.has(n.kind) && n.workspace_id && n.workspace_id !== workspace.id && stamp(n) > before)
      .sort((a, b) => stamp(b) - stamp(a))[0];
    if (fresh) setShown(fresh);
  }, [recent.data, workspace.id]);

  // Looked up as the card shows, before paint, so it never flashes in the fallback spot.
  useLayoutEffect(() => {
    setAnchor(shown ? document.querySelector(ANCHOR) : null);
  }, [shown]);

  const target = shown ? workspaces.find((w) => w.id === shown.workspace_id) : undefined;
  // Moving into its workspace answers the card: the room is in the list now.
  const card =
    shown && target && target.id !== workspace.id ? (
      <ChatMessageToast
        key={shown.id}
        n={shown}
        target={target}
        tint={workspaceTint(workspaces, target.id)}
        className={anchor?.isConnected ? "top-3 right-4" : "top-16 right-4"}
        onClose={close}
      />
    ) : null;

  return card && anchor?.isConnected ? createPortal(card, anchor) : card;
}

function ChatMessageToast({
  n,
  target,
  tint,
  className,
  onClose,
}: {
  n: Notification;
  target: Workspace;
  tint: ReturnType<typeof workspaceTint>;
  className: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const roomId = n.resource_parent_id ?? "";
  const room = useChatRooms(target.id).data?.find((r) => r.id === roomId);
  const send = useSendChatRoomMessage(target.id);
  const [held, setHeld] = useState(false);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sender = n.params.actor ?? "";

  // The room's last line is this message only while its sender still has the last word.
  const own =
    room?.last_message_sender_id?.toUpperCase() === n.actor_id.toUpperCase() &&
    (room.last_message_kind ?? "text") === "text";
  const preview = (own && deserializeMessageBodyToComposerDraft(room.last_message_body ?? "").trim()) || t(notificationTitleKey(n), n.params);

  useEffect(() => {
    if (held || replying) return;
    const timer = window.setTimeout(onClose, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [held, replying, onClose]);

  useEffect(() => {
    if (replying) inputRef.current?.focus();
  }, [replying]);

  const open = () => {
    onClose();
    push(paths.workspace(target.organization_slug, target.slug).chatConversation(roomId, n.resource_id));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ roomId, body });
      sonner.success(t("chat.toast_reply_sent"));
      onClose();
    } catch {
      sonner.error(t("chat.send_failed"));
    }
  };

  return (
    <div
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        "absolute z-30 flex w-[344px] max-w-[calc(100%-2rem)] gap-3 rounded-xl bg-popover py-3 pr-1.5 pl-3 text-popover-foreground shadow-floating",
        className,
      )}
    >
      <span className="relative size-10 shrink-0">
        <ActorAvatar
          name={sender}
          initials={initialsOf(sender)}
          size="fluid"
          className={cn("size-10 text-label", chatPersonFaceClass(n.actor_id))}
        />
        <span
          aria-hidden
          className={cn(
            "absolute -right-[5px] -bottom-[5px] flex size-[21px] items-center justify-center rounded-[7px] border-2 border-popover text-micro font-bold tracking-tighter",
            tintSolidClass[tint],
          )}
        >
          {initialsOf(target.name)}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px *:leading-tight">
        <span className={cn("text-caption font-semibold", tintForegroundClass[tint])}>{target.name}</span>
        <span className="truncate text-body font-semibold">{sender}</span>
        <span className="truncate text-label text-muted-foreground">{preview}</span>
        {replying ? (
          <form onSubmit={(event) => void submit(event)} className="mt-2 flex gap-2">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={t("chat.toast_reply_label", { name: sender })}
              placeholder={t("chat.toast_reply_label", { name: sender })}
              className="h-[34px] min-w-0 flex-1 rounded-full"
            />
            <Button type="submit" disabled={!draft.trim() || send.isPending} className="h-[34px] rounded-full px-4 text-label font-semibold">
              {t("chat.send")}
            </Button>
          </form>
        ) : (
          <span className="mt-2 flex gap-2">
            <Button onClick={open} className="h-[34px] rounded-full px-4 text-label font-semibold">
              {t("chat.toast_open")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setReplying(true)}
              disabled={!roomId}
              className="h-[34px] rounded-full px-3.5 text-label font-semibold"
            >
              {t("chat.toast_quick_reply")}
            </Button>
          </span>
        )}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label={t("chat.toast_dismiss")}
        className="-mt-2 size-11 shrink-0 rounded-lg text-muted-foreground"
      >
        <X aria-hidden className="size-[18px]" />
      </Button>
    </div>
  );
}
