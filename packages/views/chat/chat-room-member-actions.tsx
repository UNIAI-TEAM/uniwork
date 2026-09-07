"use client";

import { MessageSquareOff, MessageSquarePlus, Shield, ShieldOff, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

export function ChatRoomMemberActions({
  label,
  canPromote,
  canDemote,
  canMute,
  canUnmute,
  canKick,
  busy,
  onPromote,
  onDemote,
  onMute,
  onUnmute,
  onKick,
}: {
  label: string;
  canPromote: boolean;
  canDemote: boolean;
  canMute: boolean;
  canUnmute: boolean;
  canKick: boolean;
  busy?: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onKick: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {canPromote ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t("chat.promote_room_admin", { name: label })}
          onClick={onPromote}
        >
          <Shield className="size-4" aria-hidden />
        </Button>
      ) : null}
      {canDemote ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t("chat.demote_room_admin", { name: label })}
          onClick={onDemote}
        >
          <ShieldOff className="size-4" aria-hidden />
        </Button>
      ) : null}
      {canMute ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t("chat.mute_member", { name: label })}
          onClick={onMute}
        >
          <MessageSquareOff className="size-4" aria-hidden />
        </Button>
      ) : null}
      {canUnmute ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t("chat.unmute_member", { name: label })}
          onClick={onUnmute}
        >
          <MessageSquarePlus className="size-4" aria-hidden />
        </Button>
      ) : null}
      {canKick ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t("chat.remove_member", { name: label })}
          onClick={onKick}
        >
          <UserMinus className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
