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
import { cn } from "@uniwork/ui/lib/utils";
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
  chatSettingsIconButtonClass,
  ChatMemberRow,
  ChatSettingsCollapsibleSection,
  ChatSettingsHeader,
  ChatSettingsHero,
  ChatSettingsMenuRow,
  ChatSettingsQuickAction,
  ChatSettingsQuickActions,
  ChatSettingsSection,
} from "./chat-settings-ui";
import { CHAT_SHEET_CLASS } from "./chat-dialog-look";
import { ChatPresenceAvatar } from "./chat-presence-avatar";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";
import { ChatRoomSharedTotals } from "./chat-room-shared-totals";
import { ChatSetNicknameDialog } from "./chat-set-nickname-dialog";
import { useChatRoomPreferences } from "./use-chat-room-preferences";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { chatPersonFaceClass } from "./chat-person-card";
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
  memberAvatarByUserId = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  contact: ChatContact;
  roomId?: string | null;
  currentUserId: string;
  nicknamesByUserId?: Record<string, string>;
  memberAvatarByUserId?: MemberAvatarUrlMap;
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
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(workspaceId, roomId);
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
      <SheetContent side="right" showCloseButton={false} closeLabel={t("common.close")} className={CHAT_SHEET_CLASS}>
        <SheetHeader className="sr-only">
          <SheetTitle>{contactLabel}</SheetTitle>
          <SheetDescription>{t("chat.dm_settings_description")}</SheetDescription>
        </SheetHeader>

        <ChatSettingsHeader title={t("chat.dm_settings")} />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatSettingsHero
            mark={
              <span className="relative inline-flex">
                <ActorAvatar
                  name={contactLabel}
                  initials={initialOf(contactLabel)}
                  avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, contact.user_id)}
                  size="fluid"
                  className={cn("size-17 text-display-sm", chatPersonFaceClass(contact.user_id))}
                />
                {/* The status line under the name says it in words; the dot only repeats it. */}
                {contactOnline ? (
                  <span
                    aria-hidden
                    className="absolute right-px bottom-px size-4.5 rounded-full bg-success-solid ring-3 ring-surface-raised"
                  />
                ) : null}
              </span>
            }
            name={contactLabel}
            subtitle={
              contactOnline || contact.email ? (
                <>
                  {contactOnline ? (
                    <span className="flex items-center gap-1.5 text-label font-medium text-success">
                      <span aria-hidden className="size-2 rounded-full bg-success-solid" />
                      {t("chat.presence_online")}
                    </span>
                  ) : null}
                  {contact.email ? <span className="text-label">{contact.email}</span> : null}
                </>
              ) : undefined
            }
          />

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
            {onOpenSearch ? (
              <ChatSettingsQuickAction
                icon={Search}
                label={t("chat.search_action")}
                onClick={() => {
                  onOpenChange(false);
                  onOpenSearch();
                }}
              />
            ) : null}
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
                      <ActorAvatar
                        name={participant.label}
                        initials={initialOf(participant.label)}
                        avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, currentUserId)}
                        size="xl"
                        className={chatPersonFaceClass(currentUserId)}
                      />
                    ) : (
                      <ChatPresenceAvatar
                        name={participant.label}
                        initials={initialOf(participant.label)}
                        avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, contact.user_id)}
                        size="xl"
                        avatarClassName={chatPersonFaceClass(contact.user_id)}
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
                      size="icon"
                      className={chatSettingsIconButtonClass}
                      aria-label={t("chat.nickname_action_for", { name: participant.label })}
                      title={t("chat.nickname_action")}
                      onClick={() =>
                        participant.key === "self" ? setSelfNicknameOpen(true) : setNicknameOpen(true)
                      }
                    >
                      <Tag className="size-5" aria-hidden />
                    </Button>
                  }
                />
              ))}
            </ul>
          </ChatSettingsCollapsibleSection>

          <ChatSettingsSection className="py-1">
            <ChatSettingsMenuRow
              icon={StickyNote}
              label={t("chat.settings_notes_pins_polls")}
              onClick={() => setBulletinOpen(true)}
              disabled={!roomId}
              disabledReason={t("chat.settings_bulletin_needs_room")}
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
          </ChatSettingsSection>

          {roomId ? <ChatRoomSharedTotals workspaceId={workspaceId} roomId={roomId} open={open} /> : null}

          <ChatSettingsSection className="mt-auto px-5 pt-3.5 pb-4.5">
            <BlockConversationSection
              blockedByMe={blockedByMe}
              blockedMe={blockedMe}
              disabled={leaveDisabled}
              blocking={blocking}
              unblocking={unblocking}
              onBlock={onBlock}
              onUnblock={onUnblock}
            />

            <div className="mt-3.5 border-t border-border pt-3.5">
              <LeaveConversationSection
                variant="dm"
                disabled={leaveDisabled}
                leaving={leaving}
                onLeave={onLeave}
              />
            </div>
          </ChatSettingsSection>
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
  memberAvatarByUserId = {},
}: {
  contact: ChatContact;
  nicknamesByUserId?: Record<string, string>;
  memberAvatarByUserId?: MemberAvatarUrlMap;
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
          avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, contact.user_id)}
          size="xl"
          avatarClassName={chatPersonFaceClass(contact.user_id)}
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
