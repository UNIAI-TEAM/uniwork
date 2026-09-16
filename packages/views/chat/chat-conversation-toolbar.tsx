"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { ChatConversationHeader } from "./chat-conversation-header";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

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
    />
  );
}

export function GroupChatToolbar({
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
}: {
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
}) {
  const { t } = useTranslation();

  return (
    <ChatConversationToolbar
      avatar={<ActorAvatar name={title} initials={initialOf(title)} size="xl" />}
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
    />
  );
}
