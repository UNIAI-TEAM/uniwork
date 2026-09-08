"use client";

import { Bell, BellOff, Pin, Tag } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact, resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { ChatConversationToolbar } from "./group-settings-sheet";
import { BlockConversationSection } from "./block-conversation-section";
import { LeaveConversationSection } from "./leave-conversation-section";
import {
  ChatSettingsBulletinEntry,
  ChatSettingsCollapsibleSection,
  ChatSettingsMenuRow,
  ChatSettingsQuickAction,
  ChatSettingsQuickActionsDm,
  ChatSettingsTitleRow,
} from "./chat-settings-ui";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";
import { ChatSetNicknameDialog } from "./chat-set-nickname-dialog";
import { useChatRoomPreferences } from "./use-chat-room-preferences";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function DmSettingsSheet({
  open,
  onOpenChange,
  workspaceId,
  contact,
  roomId,
  currentUserId,
  nicknamesByUserId = {},
  youLabel,
  onLeave,
  leaving,
  leaveDisabled,
  blockedByMe,
  blockedMe,
  onBlock,
  onUnblock,
  blocking,
  unblocking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  contact: ChatContact;
  roomId?: string | null;
  currentUserId: string;
  nicknamesByUserId?: Record<string, string>;
  youLabel: string;
  onLeave: () => void | Promise<void>;
  leaving?: boolean;
  leaveDisabled?: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
  onBlock: () => void | Promise<void>;
  onUnblock: () => void | Promise<void>;
  blocking?: boolean;
  unblocking?: boolean;
}) {
  const { t } = useTranslation();
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(roomId);
  const [bulletinOpen, setBulletinOpen] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [selfNicknameOpen, setSelfNicknameOpen] = useState(false);
  const contactLabel = displayLabelForChatContact(contact, nicknamesByUserId);
  const legalName = displayLabelForChatContact(contact);
  const selfNickname = resolveChatNicknameForUser(nicknamesByUserId, currentUserId);
  const selfLabel = selfNickname || youLabel;

  const participants = [
    { key: "self", userId: currentUserId, label: selfLabel, legalLabel: youLabel, email: undefined as string | undefined },
    {
      key: contact.user_id,
      userId: contact.user_id,
      label: contactLabel,
      legalLabel: legalName,
      email: contact.email || undefined,
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="sr-only">
          <SheetTitle>{contactLabel}</SheetTitle>
          <SheetDescription>{t("chat.dm_settings_description")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatSettingsTitleRow title={contactLabel} />

          <ChatSettingsQuickActionsDm>
            <ChatSettingsQuickAction
              icon={notificationsMuted ? BellOff : Bell}
              label={t("chat.settings_mute_notifications")}
              onClick={onToggleMute}
              active={notificationsMuted}
            />
            <ChatSettingsQuickAction
              icon={Pin}
              label={t("chat.settings_pin_conversation")}
              onClick={onTogglePin}
              active={pinned}
            />
          </ChatSettingsQuickActionsDm>

          <ChatSettingsBulletinEntry
            label={t("chat.settings_notes_pins_polls")}
            onClick={() => setBulletinOpen(true)}
          />

          <section className="border-b border-border">
            <ChatSettingsMenuRow
              icon={Tag}
              label={t("chat.nickname_action")}
              onClick={() => setNicknameOpen(true)}
            />
          </section>

          <ChatSettingsCollapsibleSection
            title={t("chat.dm_participants_title")}
            summary={t("chat.group_member_count", { count: participants.length })}
          >
            <ul className="space-y-2">
              {participants.map((participant) => (
                <li
                  key={participant.key}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <ActorAvatar
                    name={participant.label}
                    initials={initialOf(participant.label)}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-foreground">{participant.label}</p>
                    {participant.label !== participant.legalLabel ? (
                      <p className="truncate text-caption text-muted-foreground">
                        {t("chat.nickname_legal_name", { name: participant.legalLabel })}
                      </p>
                    ) : participant.email ? (
                      <p className="truncate text-caption text-muted-foreground">{participant.email}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label={t("chat.nickname_action")}
                    onClick={() =>
                      participant.key === "self"
                        ? setSelfNicknameOpen(true)
                        : setNicknameOpen(true)
                    }
                  >
                    <Tag className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </ChatSettingsCollapsibleSection>

          <div className="space-y-4 px-4 pb-4">
            <BlockConversationSection
              blockedByMe={blockedByMe}
              blockedMe={blockedMe}
              disabled={leaveDisabled}
              blocking={blocking}
              unblocking={unblocking}
              onBlock={onBlock}
              onUnblock={onUnblock}
            />

            <LeaveConversationSection
              variant="dm"
              disabled={leaveDisabled}
              leaving={leaving}
              onLeave={onLeave}
            />
          </div>
        </div>

        {roomId && bulletinOpen ? (
          <ChatRoomBulletinSheet
            open={bulletinOpen}
            onOpenChange={setBulletinOpen}
            workspaceId={workspaceId}
            roomId={roomId}
            title={t("chat.settings_dm_bulletin")}
            showPolls={false}
          />
        ) : null}
        <ChatSetNicknameDialog
          open={nicknameOpen}
          onOpenChange={setNicknameOpen}
          workspaceId={workspaceId}
          targetUserId={contact.user_id}
          targetLabel={legalName}
          currentNickname={resolveChatNicknameForUser(nicknamesByUserId, contact.user_id) ?? ""}
        />
        <ChatSetNicknameDialog
          open={selfNicknameOpen}
          onOpenChange={setSelfNicknameOpen}
          workspaceId={workspaceId}
          targetUserId={currentUserId}
          targetLabel={youLabel}
          currentNickname={selfNickname ?? ""}
        />
      </SheetContent>
    </Sheet>
  );
}

export function DmChatToolbar({
  contact,
  nicknamesByUserId = {},
  backAriaLabel,
  onBack,
  onOpenSettings,
  onOpenSearch,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
}: {
  contact: ChatContact;
  nicknamesByUserId?: Record<string, string>;
  backAriaLabel?: string;
  onBack?: () => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const contactLabel = displayLabelForChatContact(contact, nicknamesByUserId);

  return (
    <ChatConversationToolbar
      avatar={
        <ActorAvatar name={contactLabel} initials={initialOf(contactLabel)} size="xl" />
      }
      title={contactLabel}
      subtitle={contact.email || t("chat.dm_direct_message")}
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      settingsAriaLabel={t("chat.dm_settings")}
      onOpenSettings={onOpenSettings}
      onOpenSearch={onOpenSearch}
      voiceCallAriaLabel={t("chat.voice_call_start")}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
      videoCallAriaLabel={t("chat.video_call_start")}
      onVideoCall={onVideoCall}
      videoCallDisabled={videoCallDisabled}
    />
  );
}
