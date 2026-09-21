"use client";

import {
  MessageSquareOff,
  MessageSquarePlus,
  MoreHorizontal,
  Shield,
  ShieldOff,
  UserMinus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

/**
 * What a moderator can do to one member, behind a single "more" button so a
 * row carries one control instead of five. Removing is last, set apart and
 * destructive; it confirms in the caller.
 */
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
  if (!canPromote && !canDemote && !canMute && !canUnmute && !canKick) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t("chat.member_actions_aria", { name: label })}
            aria-busy={busy || undefined}
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {canPromote ? (
          <DropdownMenuItem onClick={onPromote}>
            <Shield aria-hidden />
            {t("chat.promote_room_admin", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canDemote ? (
          <DropdownMenuItem onClick={onDemote}>
            <ShieldOff aria-hidden />
            {t("chat.demote_room_admin", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canMute ? (
          <DropdownMenuItem onClick={onMute}>
            <MessageSquareOff aria-hidden />
            {t("chat.mute_member", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canUnmute ? (
          <DropdownMenuItem onClick={onUnmute}>
            <MessageSquarePlus aria-hidden />
            {t("chat.unmute_member", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canKick ? (
          <>
            {canPromote || canDemote || canMute || canUnmute ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem variant="destructive" onClick={onKick}>
              <UserMinus aria-hidden />
              {t("chat.remove_member", { name: label })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
