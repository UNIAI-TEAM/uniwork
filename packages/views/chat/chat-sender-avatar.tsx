"use client";

import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { ChatPersonCard, chatPersonFaceClass, useChatPersonMessage } from "./chat-person-card";
import { initialsOf } from "./chat-initials";

type SenderProfile = {
  user_id: string;
  display_name?: string;
  email?: string;
};

function profileFor(userId: string, nameContext: SenderProfile[]): SenderProfile | undefined {
  const key = userId.trim().toUpperCase();
  return nameContext.find((entry) => entry.user_id.trim().toUpperCase() === key);
}

/** Incoming avatar: initials on the person's own colour, as in the list. A click opens the person's card. */
export function ChatSenderAvatar({
  userId,
  name,
  avatarUrl,
  nameContext = [],
}: {
  userId: string;
  name: string;
  avatarUrl?: string;
  nameContext?: SenderProfile[];
}) {
  const messagePerson = useChatPersonMessage();
  const profile = profileFor(userId, nameContext);
  const email = profile?.email?.trim() || undefined;
  return (
    <ChatPersonCard
      name={name}
      email={email}
      userId={userId}
      avatarUrl={avatarUrl}
      onMessage={
        messagePerson
          ? () => {
              messagePerson(userId);
            }
          : undefined
      }
      triggerClassName="inline-flex shrink-0 rounded-full"
    >
      {/* 34px with 12px initials (canvas): between the lg and xl tiers, so sized here. */}
      <ActorAvatar
        name={name}
        initials={initialsOf(name)}
        avatarUrl={avatarUrl}
        size="fluid"
        className={cn("size-8.5 shrink-0 text-caption", chatPersonFaceClass(userId))}
      />
    </ChatPersonCard>
  );
}
