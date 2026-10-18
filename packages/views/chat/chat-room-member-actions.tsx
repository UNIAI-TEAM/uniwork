"use client";

import {
  MessageSquareOff,
  MessageSquarePlus,
  Ellipsis,
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
import { cn } from "@uniwork/ui/lib/utils";
import { chatSettingsIconButtonClass } from "./chat-settings-ui";

/* Canvas menu rows: 42px, 14px label, 18px icon 12px before it; removing reads red and medium. */
const ITEM = "h-10.5 gap-3 rounded-[10px] px-3 text-body [&_svg]:size-4.5";

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
  kickLabel,
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
  /** Menu text for removing; defaults to removing from this room. */
  kickLabel?: string;
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
            size="icon"
            className={cn(chatSettingsIconButtonClass, "data-popup-open:bg-tint-gray data-popup-open:text-foreground")}
            aria-label={t("chat.member_actions_aria", { name: label })}
            aria-busy={busy || undefined}
          />
        }
      >
        <Ellipsis className="size-4.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-58 rounded-[14px] p-1.5">
        {canPromote ? (
          <DropdownMenuItem className={cn(ITEM, "[&_svg]:text-muted-foreground")} onClick={onPromote}>
            <Shield aria-hidden />
            {t("chat.promote_room_admin", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canDemote ? (
          <DropdownMenuItem className={cn(ITEM, "[&_svg]:text-muted-foreground")} onClick={onDemote}>
            <ShieldOff aria-hidden />
            {t("chat.demote_room_admin", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canMute ? (
          <DropdownMenuItem className={cn(ITEM, "[&_svg]:text-muted-foreground")} onClick={onMute}>
            <MessageSquareOff aria-hidden />
            {t("chat.mute_member", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canUnmute ? (
          <DropdownMenuItem className={cn(ITEM, "[&_svg]:text-muted-foreground")} onClick={onUnmute}>
            <MessageSquarePlus aria-hidden />
            {t("chat.unmute_member", { name: label })}
          </DropdownMenuItem>
        ) : null}
        {canKick ? (
          <>
            {canPromote || canDemote || canMute || canUnmute ? <DropdownMenuSeparator className="mx-1 my-1.5" /> : null}
            <DropdownMenuItem variant="destructive" className={cn(ITEM, "font-medium")} onClick={onKick}>
              <UserMinus aria-hidden />
              {kickLabel ?? t("chat.remove_member", { name: label })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
