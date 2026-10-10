"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChatUnreadBadge } from "@uniwork/core/chat";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import { useNotifications } from "@uniwork/core/notifications";
import { usePush } from "@uniwork/core/notifications/push";
import { getWebNotificationPermission, showWebNotification } from "@uniwork/core/platform";
import { resourceHref } from "../notifications/resource-href";
import { useWorkspace } from "./workspace-context";

const TITLE_COUNT = /^\(\d+\) /;
/** Kinds worth a banner over whatever the person is doing in another tab (H1). */
const BANNER_KINDS = new Set(["chat_dm", "chat_mentioned"]);

/** Prefixes the tab title with the count, and keeps it there when the router rewrites the title. */
function useTitleCount(count: number) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_COUNT, "");
      const next = count > 0 ? `(${count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(TITLE_COUNT, "");
    };
  }, [count]);
}

/**
 * Chat reaching a person who is not looking at Chat: the unread count in the
 * tab title, and a browser banner for a new DM or mention while the tab is
 * hidden. The banner needs permission already granted (never prompted here)
 * and stays off while this browser has Web Push, which shows the same thing.
 * It watches the unread notifications the realtime sync already refetches on
 * notification.created, so the rows, titles and preferences are the inbox's.
 */
export function WorkspaceChatAttention() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  useTitleCount(useChatUnreadBadge(workspace.id));

  const push = usePush();
  const banners = getWebNotificationPermission() === "granted" && !push.subscribed;
  const recent = useNotifications({ unreadOnly: true, limit: 20, enabled: banners });
  /** Newest `updated_at ?? created_at` seen so far; null before the first load. */
  const newestSeen = useRef<number | null>(null);
  useEffect(() => {
    const rows = recent.data?.notifications;
    if (!rows) return;
    const stamp = (n: (typeof rows)[number]) => Date.parse(n.updated_at ?? n.created_at) || 0;
    const before = newestSeen.current;
    newestSeen.current = Math.max(before ?? -Infinity, ...rows.map(stamp));
    // The first load is the backlog, not news; a visible tab has the inbox.
    if (before === null || document.visibilityState !== "hidden") return;
    const muted = useChatRoomPreferencesStore.getState().isNotificationsMuted;
    for (const n of rows) {
      // Only what is newer than anything seen: an old row the top-20 window
      // pulls in once newer ones are read is not news (UNI-1074).
      if (!BANNER_KINDS.has(n.kind) || stamp(n) <= before) continue;
      if (n.resource_parent_id && muted(n.resource_parent_id)) continue;
      // The id is the tag: a merged row replaces its earlier banner.
      showWebNotification({
        slug: workspace.slug,
        itemId: n.id,
        issueKey: n.id,
        href: resourceHref(n, workspace),
        title: t(n.title_key, n.params),
        body: "",
      });
    }
  }, [recent.data, t, workspace]);
  return null;
}
