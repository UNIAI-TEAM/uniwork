"use client";

import { Settings, Phone, UserPlus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { matrixLocalpart } from "@uniwork/core/chat/matrix-users";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { MatrixClient } from "matrix-js-sdk";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { readGroupRoomMembers } from "./matrix-group";
import { LeaveConversationSection } from "./leave-conversation-section";

type MemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
  matrix_user_id: string | null;
};

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function GroupSettingsSheet({
  open,
  onOpenChange,
  group,
  client,
  roomId,
  myMatrixUserId,
  youLabel,
  memberProfiles,
  onAddMembers,
  onLeave,
  leaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupChat;
  client: MatrixClient | null;
  roomId: string | null;
  myMatrixUserId: string;
  youLabel: string;
  memberProfiles: Record<string, MemberProfile>;
  onAddMembers: () => void;
  onLeave: () => void | Promise<void>;
  leaving?: boolean;
}) {
  const { t } = useTranslation();

  const members = useMemo(() => {
    if (!client || !roomId) return [];
    return readGroupRoomMembers(client, roomId).map((member) => {
      const uniworkId = matrixLocalpart(member.matrixUserId).toUpperCase();
      const isSelf = member.matrixUserId === myMatrixUserId;
      const profile = memberProfiles[uniworkId];
      const label = isSelf
        ? youLabel
        : (profile?.display_name || profile?.email || uniworkId);
      return {
        key: member.matrixUserId,
        label,
        email: isSelf ? undefined : profile?.email,
        membership: member.membership,
        isSelf,
      };
    });
  }, [client, roomId, myMatrixUserId, youLabel, memberProfiles]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{group.name}</SheetTitle>
          <SheetDescription>{t("chat.group_settings_description")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-label font-medium text-foreground">{t("chat.group_members_title")}</h2>
            <span className="text-caption text-muted-foreground">
              {t("chat.group_member_count", { count: members.length })}
            </span>
          </div>

          <ul className="space-y-2">
            {members.map((member) => (
              <li
                key={member.key}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <ActorAvatar name={member.label} initials={initialOf(member.label)} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">{member.label}</p>
                  {member.email ? (
                    <p className="truncate text-caption text-muted-foreground">{member.email}</p>
                  ) : null}
                </div>
                {member.membership === "invite" ? (
                  <Badge variant="secondary">{t("chat.member_invited")}</Badge>
                ) : null}
              </li>
            ))}
          </ul>

          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => {
              onOpenChange(false);
              onAddMembers();
            }}
          >
            <UserPlus className="size-4" aria-hidden />
            {t("chat.add_group_members")}
          </Button>

          <LeaveConversationSection
            variant="group"
            disabled={!client || !roomId}
            leaving={leaving}
            onLeave={onLeave}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ChatConversationToolbar({
  title,
  subtitle,
  settingsAriaLabel,
  onOpenSettings,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
}: {
  title: string;
  subtitle: string;
  settingsAriaLabel: string;
  onOpenSettings: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-body font-medium text-foreground">{title}</p>
        <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onVoiceCall ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={voiceCallAriaLabel}
            disabled={voiceCallDisabled}
            onClick={onVoiceCall}
          >
            <Phone className="size-4" aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={settingsAriaLabel}
          onClick={onOpenSettings}
        >
          <Settings className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function GroupChatToolbar({
  title,
  memberCount,
  onOpenSettings,
}: {
  title: string;
  memberCount: number;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ChatConversationToolbar
      title={title}
      subtitle={t("chat.group_member_count", { count: memberCount })}
      settingsAriaLabel={t("chat.group_settings")}
      onOpenSettings={onOpenSettings}
    />
  );
}
