"use client";

import { useEffect, useRef } from "react";
import { usePerson } from "@uniwork/core/people";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import { DM_PARAM } from "./use-chat-room-url";

/**
 * `/chat?dm=<userId>` opens the one-to-one conversation with that person —
 * the address the directory's "Nhắn tin" goes to. It cannot link to the room
 * itself: a DM with no message yet is not in the room list, so `?room=` would
 * find nothing and fall back to the workspace room.
 *
 * The person's name comes from the directory, not the URL, so no name or
 * address is ever written into a link. The same path as "Nhắn tin với người
 * mới" then takes over: the DM resolves, and the room URL replaces `?dm=`.
 * Someone who cannot be messaged (the reader, a deactivated or unknown
 * person) leaves Chat where it was.
 */
export function useChatDmDeepLink(
  openTarget: (target: ChatSidebarTarget) => void,
  /**
   * The room list has loaded. Opening before it did raced the room URL: with
   * the person already cached (a second "Nhắn tin" to the same colleague) the
   * DM opened on the first render, its room reached the URL before the list,
   * and the URL sync dropped it as unknown — landing on the workspace room.
   */
  roomsReady: boolean,
): void {
  const nav = useOptionalNavigation();
  const orgSlug = useOptionalWorkspace()?.workspace.organization_slug ?? "";
  const userId = nav?.searchParams.get(DM_PARAM) ?? "";
  const { data, isError } = usePerson(orgSlug, userId);
  const handled = useRef<string | null>(null);
  const openRef = useRef(openTarget);
  openRef.current = openTarget;

  useEffect(() => {
    if (!userId || !roomsReady || handled.current === userId) return;
    if (!data && !isError) return;
    handled.current = userId;
    const person = data?.person;
    if (!person || person.is_self || person.status === "deactivated") return;
    openRef.current({
      kind: "dm",
      contact: { user_id: person.user_id, email: person.email, display_name: person.display_name },
    });
  }, [data, isError, roomsReady, userId]);
}
