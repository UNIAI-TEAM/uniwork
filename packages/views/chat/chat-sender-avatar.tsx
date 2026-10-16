"use client";

import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { ChatPersonCard, useChatPersonMessage } from "./chat-person-card";
import { initialOf } from "./chat-initials";

type SenderProfile = {
  user_id: string;
  display_name?: string;
  email?: string;
};

function profileFor(userId: string, nameContext: SenderProfile[]): SenderProfile | undefined {
  const key = userId.trim().toUpperCase();
  return nameContext.find((entry) => entry.user_id.trim().toUpperCase() === key);
}

/** Incoming avatar. A click opens the person's card. */
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
      <ActorAvatar name={name} initials={initialOf(name)} avatarUrl={avatarUrl} size="lg" className="shrink-0" />
    </ChatPersonCard>
  );
}
