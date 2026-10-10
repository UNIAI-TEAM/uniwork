import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import { initI18n } from "@uniwork/core/i18n";
import { registerSystemNotificationClickHandler } from "@uniwork/core/platform";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock } from "../test/api-mock";
import { WorkspaceChatAttention } from "./workspace-chat-attention";
import { WorkspaceProvider } from "./workspace-context";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1",
  organization_slug: "acme", organization_name: "Acme",
};

const room = (id: string, unread: number, mentions: number) => ({
  id, kind: "channel", name: id, workspace_id: "ws1", member_user_ids: [],
  unread_count: unread, mention_unread_count: mentions,
});
const dm = (id: string, updated: string, actor = "Bình") => ({
  id, kind: "chat_dm", resource_type: "chat_message", resource_id: "m1", resource_parent_id: "r1",
  title_key: "notifications.kind.chat_dm", params: { actor }, created_at: updated, updated_at: updated,
});

let notifications: unknown[] = [];

function renderAttention() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider workspace={workspace} user={user}>
        <WorkspaceChatAttention />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
}

beforeEach(() => {
  document.title = "UniWork";
  notifications = [];
  useChatRoomPreferencesStore.setState({ byRoomId: { muted: { notificationsMuted: true, pinned: false, pinnedAt: 0 } } });
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/chat/rooms")) return Promise.resolve({ rooms: [room("r1", 2, 0), room("muted", 5, 1)] });
    if (path.startsWith("/api/v1/me/notifications?")) return Promise.resolve({ notifications, next_before: "" });
    if (path === "/api/v1/notifications/push/config") return Promise.resolve({ enabled: false });
    return Promise.resolve({});
  });
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(user);
});

afterEach(() => {
  setHidden(false);
  vi.unstubAllGlobals();
});

describe("WorkspaceChatAttention", () => {
  it("puts the chat unread count in the tab title, mentions only for a muted room", async () => {
    const { unmount } = renderAttention();
    await waitFor(() => expect(document.title).toBe("(3) UniWork"));
    unmount();
    expect(document.title).toBe("UniWork");
  });

  it("shows a browser notification for a new DM while the tab is hidden", async () => {
    const shown: string[] = [];
    class FakeNotification {
      static permission = "granted";
      onclick: (() => void) | null = null;
      constructor(title: string) {
        shown.push(title);
      }
      close() {}
    }
    vi.stubGlobal("Notification", FakeNotification);
    setHidden(true);
    notifications = [dm("old", "2026-10-09T00:00:00Z")];
    const { client } = renderAttention();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/me/notifications?")));
    await act(async () => {
      await client.refetchQueries();
    });
    // The backlog that was there on load is not news.
    expect(shown).toEqual([]);

    notifications = [dm("new", "2026-10-09T01:00:00Z"), dm("old", "2026-10-09T00:00:00Z")];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notifications"] });
    });
    await waitFor(() => expect(shown).toEqual(["Bình đã nhắn tin cho bạn"]));
  });

  // UNI-1074: a row older than everything seen (pulled into the top 20 when
  // newer ones were read) is not news either; and a click opens the message.
  it("banners only rows newer than the newest seen, and carries where a click goes", async () => {
    const shown: Array<{ title: string; tag?: string }> = [];
    const instances: Array<{ onclick: (() => void) | null }> = [];
    class FakeNotification {
      static permission = "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        shown.push({ title, tag: options?.tag });
        instances.push(this);
      }
      close() {}
    }
    vi.stubGlobal("Notification", FakeNotification);
    const clicked = vi.fn();
    registerSystemNotificationClickHandler(clicked);
    setHidden(true);
    notifications = [dm("seen", "2026-10-09T01:00:00Z")];
    const { client } = renderAttention();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/me/notifications?")));
    await act(async () => {
      await client.refetchQueries();
    });

    notifications = [
      dm("new", "2026-10-09T02:00:00Z", "Chi"),
      dm("seen", "2026-10-09T01:00:00Z"),
      dm("old", "2026-10-08T00:00:00Z", "Dũng"),
    ];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notifications"] });
    });
    await waitFor(() => expect(shown).toEqual([{ title: "Chi đã nhắn tin cho bạn", tag: "new" }]));

    instances[0]?.onclick?.();
    expect(clicked).toHaveBeenCalledWith(expect.objectContaining({ href: "/acme/team/chat?room=r1&message=m1" }));
    registerSystemNotificationClickHandler(null);
  });
});
