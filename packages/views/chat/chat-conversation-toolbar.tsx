"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Users, type LucideIcon } from "lucide-react";
import { ChatConversationHeader } from "./chat-conversation-header";
import { ChatRoomMark } from "./chat-room-mark";

export function ChatConversationToolbar({
  avatar,
  title,
  subtitle,
  backAriaLabel,
  onBack,
  sidebarCollapsed,
  onToggleSidebar,
  settingsAriaLabel,
  onOpenSettings,
  catchUpAriaLabel,
  onCatchUp,
  catchUpDisabled,
  recordingsAriaLabel,
  onOpenRecordings,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
  videoCallAriaLabel,
  onVideoCall,
  videoCallDisabled,
  onSearch,
}: {
  avatar: ReactNode;
  title: string;
  subtitle: string;
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  settingsAriaLabel: string;
  onOpenSettings: () => void;
  catchUpAriaLabel?: string;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  recordingsAriaLabel?: string;
  onOpenRecordings?: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  videoCallAriaLabel?: string;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
  onSearch?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ChatConversationHeader
      avatar={avatar}
      title={title}
      subtitle={subtitle}
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      sidebarCollapsed={sidebarCollapsed}
      sidebarToggleAriaLabel={
        sidebarCollapsed ? t("chat.show_conversations") : t("chat.hide_conversations")
      }
      onToggleSidebar={onToggleSidebar}
      settingsAriaLabel={settingsAriaLabel}
      onOpenSettings={onOpenSettings}
      catchUpAriaLabel={catchUpAriaLabel}
      onCatchUp={onCatchUp}
      catchUpDisabled={catchUpDisabled}
      recordingsAriaLabel={recordingsAriaLabel}
      onOpenRecordings={onOpenRecordings}
      voiceCallAriaLabel={voiceCallAriaLabel}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
      videoCallAriaLabel={videoCallAriaLabel}
      onVideoCall={onVideoCall}
      videoCallDisabled={videoCallDisabled}
      searchAriaLabel={t("chat.message_list.search_open")}
      onSearch={onSearch}
    />
  );
}

export function GroupChatToolbar({
  icon = Users,
  title,
  memberCount,
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
  onSearch,
}: {
  /** Users for a group; Hash or Lock for a channel. */
  icon?: LucideIcon;
  title: string;
  memberCount: number;
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
  onSearch?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ChatConversationToolbar
      avatar={<ChatRoomMark icon={icon} size="header" />}
      title={title}
      subtitle={t("chat.group_member_count", { count: memberCount })}
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      settingsAriaLabel={t("chat.group_settings")}
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
      onSearch={onSearch}
    />
  );
}
