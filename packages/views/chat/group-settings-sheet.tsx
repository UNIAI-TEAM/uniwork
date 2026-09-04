"use client";

import type { ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { LeaveConversationSection } from "./leave-conversation-section";
import { ChatConversationHeader } from "./chat-conversation-header";

type MemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
};

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function GroupSettingsSheet({
  open,
  onOpenChange,
  group,
  currentUserId,
  youLabel,
  memberProfiles,
  onAddMembers,
  onLeave,
  leaving,
  leaveDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupChat;
  currentUserId: string;
  youLabel: string;
  memberProfiles: Record<string, MemberProfile>;
  onAddMembers: () => void;
  onLeave: () => void | Promise<void>;
  leaving?: boolean;
  leaveDisabled?: boolean;
}) {
  const { t } = useTranslation();

  const members = useMemo(() => {
    const entries = [
      {
        key: currentUserId,
        label: youLabel,
        email: undefined as string | undefined,
        isSelf: true,
      },
      ...group.member_user_ids.map((memberId) => {
        const profile = memberProfiles[memberId];
        return {
          key: memberId,
          label: profile?.display_name?.trim() || profile?.email || memberId,
          email: profile?.email,
          isSelf: false,
        };
      }),
    ];
    return entries;
  }, [currentUserId, youLabel, group.member_user_ids, memberProfiles]);

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
            disabled={leaveDisabled}
            leaving={leaving}
            onLeave={onLeave}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ChatConversationToolbar({
  avatar,
  title,
  subtitle,
  settingsAriaLabel,
  onOpenSettings,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
}: {
  avatar: ReactNode;
  title: string;
  subtitle: string;
  settingsAriaLabel: string;
  onOpenSettings: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
}) {
  return (
    <ChatConversationHeader
      avatar={avatar}
      title={title}
      subtitle={subtitle}
      settingsAriaLabel={settingsAriaLabel}
      onOpenSettings={onOpenSettings}
      voiceCallAriaLabel={voiceCallAriaLabel}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
    />
  );
}

export function GroupChatToolbar({
  title,
  memberCount,
  onOpenSettings,
  onVoiceCall,
  voiceCallDisabled,
}: {
  title: string;
  memberCount: number;
  onOpenSettings: () => void;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ChatConversationToolbar
      avatar={
        <ActorAvatar name={title} initials={initialOf(title)} size="xl" />
      }
      title={title}
      subtitle={t("chat.group_member_count", { count: memberCount })}
      settingsAriaLabel={t("chat.group_settings")}
      onOpenSettings={onOpenSettings}
      voiceCallAriaLabel={t("chat.voice_call_start")}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
    />
  );
}
