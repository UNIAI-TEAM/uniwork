"use client";

import { Bell, BellOff, Pin, Search, StickyNote, Tag } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact, resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { ChatConversationToolbar } from "./chat-conversation-toolbar";
import { BlockConversationSection } from "./block-conversation-section";
import { LeaveConversationSection } from "./leave-conversation-section";
import {
  ChatMemberRow,
  ChatSettingsCollapsibleSection,
  ChatSettingsMenuRow,
  ChatSettingsQuickAction,
  ChatSettingsQuickActions,
  ChatSettingsTitleRow,
} from "./chat-settings-ui";
import { ChatPresenceAvatar } from "./chat-presence-avatar";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";
import { ChatSetNicknameDialog } from "./chat-set-nickname-dialog";
import { useChatRoomPreferences } from "./use-chat-room-preferences";
import { initialOf } from "./chat-initials";

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
  onOpenSearch,
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
  onOpenSearch?: () => void;
}) {
  const { t } = useTranslation();
  const onlineUserIds = usePresenceStore((state) => state.onlineUserIds);
  const contactOnline = Boolean(onlineUserIds[normalizeTypingUserId(contact.user_id)]);
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

          <ChatSettingsQuickActions>
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
          </ChatSettingsQuickActions>

          <ChatSettingsCollapsibleSection
            title={t("chat.dm_participants_title")}
            summary={t("chat.group_member_count", { count: participants.length })}
            flush
          >
            <ul>
              {participants.map((participant) => (
                <ChatMemberRow
                  key={participant.key}
                  avatar={
                    participant.key === "self" ? (
                      <ActorAvatar name={participant.label} initials={initialOf(participant.label)} size="lg" />
                    ) : (
                      <ChatPresenceAvatar
                        name={participant.label}
                        initials={initialOf(participant.label)}
                        size="lg"
                        online={contactOnline}
                      />
                    )
                  }
                  name={participant.label}
                  detail={
                    participant.label !== participant.legalLabel
                      ? t("chat.nickname_legal_name", { name: participant.legalLabel })
                      : participant.key !== "self" && contactOnline
                        ? t("chat.presence_online")
                        : participant.email || undefined
                  }
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t("chat.nickname_action_for", { name: participant.label })}
                      title={t("chat.nickname_action")}
                      onClick={() =>
                        participant.key === "self" ? setSelfNicknameOpen(true) : setNicknameOpen(true)
                      }
                    >
                      <Tag aria-hidden />
                    </Button>
                  }
                />
              ))}
            </ul>
          </ChatSettingsCollapsibleSection>

          <section className="border-b border-border py-1">
            <ChatSettingsMenuRow
              icon={StickyNote}
              label={t("chat.settings_notes_pins_polls")}
              onClick={() => setBulletinOpen(true)}
            />
            {onOpenSearch ? (
              <ChatSettingsMenuRow
                icon={Search}
                label={t("chat.search_messages")}
                onClick={() => {
                  onOpenChange(false);
                  onOpenSearch();
                }}
              />
            ) : null}
            <ChatSettingsMenuRow
              icon={Tag}
              label={t("chat.nickname_action")}
              onClick={() => setNicknameOpen(true)}
            />
          </section>

          <div className="space-y-4 px-4 py-4">
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
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  onCatchUp,
  catchUpDisabled,
  onOpenRecordings,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
}: {
  contact: ChatContact;
  nicknamesByUserId?: Record<string, string>;
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings: () => void;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  onOpenRecordings?: () => void;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const contactLabel = displayLabelForChatContact(contact, nicknamesByUserId);
  const online = usePresenceStore((state) =>
    Boolean(state.onlineUserIds[normalizeTypingUserId(contact.user_id)]),
  );

  return (
    <ChatConversationToolbar
      avatar={
        <ChatPresenceAvatar
          name={contactLabel}
          initials={initialOf(contactLabel)}
          size="xl"
          online={online}
        />
      }
      title={contactLabel}
      subtitle={
        online
          ? t("chat.presence_online")
          : contact.email || t("chat.dm_direct_message")
      }
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      settingsAriaLabel={t("chat.dm_settings")}
      onOpenSettings={onOpenSettings}
      catchUpAriaLabel={t("chat.ai.catch_up")}
      onCatchUp={onCatchUp}
      catchUpDisabled={catchUpDisabled}
      recordingsAriaLabel={t("chat.voice_recordings_open")}
      onOpenRecordings={onOpenRecordings}
      voiceCallAriaLabel={t("chat.voice_call_start")}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
      videoCallAriaLabel={t("chat.video_call_start")}
      onVideoCall={onVideoCall}
      videoCallDisabled={videoCallDisabled}
    />
  );
}
