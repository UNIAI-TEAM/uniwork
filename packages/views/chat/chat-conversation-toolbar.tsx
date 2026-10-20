"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChatConversationHeader } from "./chat-conversation-header";

/** What every room header shares: the way back, the list toggle, the info panel and the calls. */
export type ChatToolbarCommonProps = {
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  typingLabel?: string | null;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
  onSearch?: () => void;
  searchOpen?: boolean;
  titleAddon?: ReactNode;
};

export function ChatConversationToolbar({
  avatar,
  title,
  subtitle,
  panelAriaLabel,
  sidebarCollapsed,
  ...rest
}: ChatToolbarCommonProps & {
  avatar: ReactNode;
  title: string;
  subtitle: ReactNode;
  panelAriaLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <ChatConversationHeader
      {...rest}
      avatar={avatar}
      title={title}
      subtitle={subtitle}
      sidebarCollapsed={sidebarCollapsed}
      sidebarToggleAriaLabel={sidebarCollapsed ? t("chat.show_conversations") : t("chat.hide_conversations")}
      panelAriaLabel={panelAriaLabel}
      catchUpAriaLabel={t("chat.ai.catch_up")}
      voiceCallAriaLabel={t("chat.voice_call_start")}
      videoCallAriaLabel={t("chat.video_call_start")}
      searchAriaLabel={t("chat.message_list.search_open")}
    />
  );
}

/** "12 thành viên · 4 đang hoạt động" — the second half only while someone is online. */
export function chatMembersLine(
  t: (key: string, options?: Record<string, string | number>) => string,
  memberCount: number,
  onlineCount: number,
): string {
  const members = t("chat.group_member_count", { count: memberCount });
  return onlineCount > 0 ? `${members} · ${t("chat.info_panel.online_count", { count: onlineCount })}` : members;
}
