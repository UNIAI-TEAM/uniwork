"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import { useMembers } from "@uniwork/core/workspaces";
import { memberAvatarUrl } from "../chat/chat-member-avatar";

/** Lowercase trimmed; strips `Display Name <addr>` down to the addr part. */
export function normalizeEmailHubAddress(raw: string): string {
  const trimmed = raw.trim();
  const angled = trimmed.match(/<([^>]+)>/);
  return (angled?.[1] ?? trimmed).trim().toLowerCase();
}

type Lookup = (fromAddr?: string) => string | undefined;

const EmailHubSenderAvatarContext = createContext<Lookup>(() => undefined);

export function EmailHubSenderAvatarProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const { data: members = [] } = useMembers(workspaceId);
  const authUser = useAuthStore((s) => (s.status === "authed" ? s.user : null));

  const byEmail = useMemo(() => {
    const map: Record<string, string> = {};
    for (const member of members) {
      const url = memberAvatarUrl(member.avatar_url);
      const email = member.email?.trim();
      if (url && email) map[normalizeEmailHubAddress(email)] = url;
    }
    const selfUrl = memberAvatarUrl(authUser?.avatar_url);
    const selfEmail = authUser?.email?.trim();
    if (selfUrl && selfEmail) map[normalizeEmailHubAddress(selfEmail)] = selfUrl;
    return map;
  }, [members, authUser?.avatar_url, authUser?.email]);

  const lookup = useMemo<Lookup>(
    () => (fromAddr) => {
      if (!fromAddr?.trim()) return undefined;
      return byEmail[normalizeEmailHubAddress(fromAddr)];
    },
    [byEmail],
  );

  return (
    <EmailHubSenderAvatarContext.Provider value={lookup}>{children}</EmailHubSenderAvatarContext.Provider>
  );
}

export function useEmailHubSenderAvatarUrl(fromAddr?: string): string | undefined {
  const lookup = useContext(EmailHubSenderAvatarContext);
  return lookup(fromAddr);
}
