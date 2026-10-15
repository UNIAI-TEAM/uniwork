"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Mail, MessageSquare, Phone, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { selectIsUserOnline, usePresenceStore } from "@uniwork/core/chat/presence-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { initialOf } from "./chat-initials";
import { PersonSharedSection } from "./chat-person-shared-panel";

type ChatPersonCall = (userId: string, options?: { withCamera?: boolean }) => void;

type ChatPersonActions = {
  onMessage: ((userId: string) => void) | null;
  onCall: ChatPersonCall | null;
  /** The conversation the avatar was clicked in. Shared media comes from here. */
  roomId: string | null;
};

/** Message and call for the person whose avatar was clicked. */
const ChatPersonMessageContext = createContext<ChatPersonActions | null>(null);

export function ChatPersonMessageProvider({
  onMessage,
  onCall = null,
  roomId = null,
  children,
}: {
  onMessage: ((userId: string) => void) | null;
  onCall?: ChatPersonCall | null;
  roomId?: string | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ onMessage, onCall, roomId }), [onCall, onMessage, roomId]);
  return <ChatPersonMessageContext.Provider value={value}>{children}</ChatPersonMessageContext.Provider>;
}

/** The direct-message contact for a clicked person, or null when it is yourself. */
export function personDirectMessageContact(
  userId: string,
  currentUserId: string,
  people: ReadonlyArray<{ user_id: string; display_name: string; email?: string }>,
): { user_id: string; email: string; display_name: string } | null {
  const key = userId.trim().toUpperCase();
  if (!key || key === currentUserId.trim().toUpperCase()) return null;
  const person = people.find((entry) => entry.user_id.trim().toUpperCase() === key);
  return {
    user_id: person?.user_id ?? userId,
    email: person?.email ?? "",
    display_name: person?.display_name?.trim() || person?.email || userId,
  };
}

function PersonCardProfile({
  name,
  email,
  roleLine,
  avatarUrl,
  status,
  online,
  message,
  call,
}: {
  name: string;
  email?: string;
  roleLine?: string;
  avatarUrl?: string;
  status: string | null;
  online: boolean;
  message?: () => void;
  call?: (withCamera: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="flex flex-col items-center bg-muted px-6 pt-8 pb-6 text-center">
        <ActorAvatar
          name={name}
          initials={initialOf(name)}
          avatarUrl={avatarUrl}
          size="fluid"
          className="size-24 text-display-sm ring-4 ring-surface-raised"
        />
        <DialogTitle className="mt-4 max-w-full truncate text-title leading-tight font-semibold">{name}</DialogTitle>
        <DialogDescription
          className={
            status
              ? cn("mt-1 inline-flex items-center gap-1.5 text-caption", online ? "text-success" : "text-muted-foreground")
              : "sr-only"
          }
        >
          {status ? <span aria-hidden className={cn("size-2 rounded-full", online ? "bg-success-solid" : "bg-muted-foreground")} /> : null}
          {status ?? name}
        </DialogDescription>
      </div>
      {message || call ? (
        <div className="flex justify-center gap-1 px-3 py-4">
          {message ? <PersonCardAction icon={MessageSquare} label={t("chat.person_card_message")} onClick={message} /> : null}
          {call ? <PersonCardAction icon={Phone} label={t("chat.person_card_call")} onClick={() => call(false)} /> : null}
          {call ? <PersonCardAction icon={Video} label={t("chat.person_card_video")} onClick={() => call(true)} /> : null}
        </div>
      ) : null}
      {email || roleLine ? (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2.5 text-left">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground ring-1 ring-surface-border">
              <Mail className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              {email ? <p className="truncate text-body text-foreground">{email}</p> : null}
              {email ? <p className="text-caption text-muted-foreground">{t("chat.person_card_email")}</p> : null}
              {roleLine ? <p className="truncate text-caption text-muted-foreground">{roleLine}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sameId(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

/**
 * The card a click on someone's face opens: their photo, name, whether they
 * are active, their address, and — when they are someone else — a direct
 * message, a voice call, and a video call.
 */
export function ChatPersonCard({
  name,
  email,
  detail,
  userId,
  avatarUrl,
  onMessage,
  children,
  triggerClassName,
}: {
  name: string;
  email?: string;
  detail?: string;
  userId?: string;
  avatarUrl?: string;
  onMessage?: () => void;
  children: ReactNode;
  triggerClassName: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const personActions = useContext(ChatPersonMessageContext);
  const currentUserId = useAuthStore((state) => state.user?.id ?? "");
  const online = usePresenceStore((state) => (userId ? selectIsUserOnline(state, userId) : false));
  const isSelf = Boolean(userId && currentUserId && sameId(userId, currentUserId));
  const status = !userId || isSelf ? null : online ? t("chat.presence_online") : t("chat.presence_offline");
  const roleLine = detail && detail !== email ? detail : undefined;
  const message = onMessage
    ? () => {
        setOpen(false);
        onMessage();
      }
    : undefined;
  const call =
    !isSelf && userId && personActions?.onCall
      ? (withCamera: boolean) => {
          setOpen(false);
          personActions.onCall?.(userId, withCamera ? { withCamera: true } : undefined);
        }
      : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<button type="button" />}
        className={cn(triggerClassName, "cursor-pointer")}
        aria-label={t("chat.message_list.sender_profile", { name })}
      >
        {children}
      </DialogTrigger>
      <DialogContent
        closeLabel={t("common.close")}
        className="flex max-h-[min(40rem,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-sm"
      >
        {open && userId && !isSelf ? (
          <PersonSharedSection
            key={userId}
            userId={userId}
            roomId={personActions?.roomId ?? null}
            onClose={() => setOpen(false)}
            profile={
              <PersonCardProfile
                name={name}
                email={email}
                roleLine={roleLine}
                avatarUrl={avatarUrl}
                status={status}
                online={online}
                message={message}
                call={call}
              />
            }
          />
        ) : (
          <PersonCardProfile
            name={name}
            email={email}
            roleLine={roleLine}
            avatarUrl={avatarUrl}
            status={status}
            online={online}
            message={message}
            call={call}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useChatPersonMessage(): ((userId: string) => void) | null {
  return useContext(ChatPersonMessageContext)?.onMessage ?? null;
}

function PersonCardAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-w-16 flex-col gap-1.5 rounded-xl px-2 py-1.5 text-caption text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onClick}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground ring-1 ring-surface-border">
        <Icon className="size-5" aria-hidden />
      </span>
      {label}
    </Button>
  );
}
