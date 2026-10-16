"use client";

import type { ReactNode } from "react";
import { ChatPersonCard } from "./chat-person-card";

/** The person a member-list click can open a direct message with. */
export type ChatMemberMessageTarget = {
  user_id: string;
  email: string;
  display_name: string;
};

/**
 * The face and name in a member list. Clicking opens their card and, for
 * someone else, a direct-message action.
 */
export function ChatMemberProfileTrigger({
  name,
  email,
  detail,
  userId,
  avatarUrl,
  onMessage,
  children,
}: {
  name: string;
  email?: string;
  detail?: string;
  userId?: string;
  avatarUrl?: string;
  onMessage?: () => void;
  children: ReactNode;
}) {
  return (
    <ChatPersonCard
      name={name}
      email={email}
      detail={detail}
      userId={userId}
      avatarUrl={avatarUrl}
      onMessage={onMessage}
      triggerClassName="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
    >
      {children}
    </ChatPersonCard>
  );
}
