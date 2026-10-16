import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useChatRooms } from "@uniwork/core/chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { ChatPageView } from "./chat-page-view";

// jsdom cannot measure the virtual list: render every row.
vi.mock("./virtual-chat-message-list", () => ({
  updateStickToBottomFromScroll: () => true,
  VirtualChatMessageList: ({
    messages,
    header,
    empty,
    renderMessage,
  }: {
    messages: unknown[];
    header: React.ReactNode;
    empty: React.ReactNode;
    renderMessage: (index: number) => React.ReactNode;
  }) => (
    <>
      {header}
      {messages.length === 0 ? empty : messages.map((_, index) => renderMessage(index))}
    </>
  ),
}));

// No socket: the page's realtime hooks see "not connected yet".
vi.mock("../../core/realtime/provider", async (orig) => ({
  ...(await orig<typeof import("../../core/realtime/provider")>()),
  useWS: () => ({ client: null }),
  useOptionalWS: () => ({ client: null }),
}));

vi.mock("./chat-voice-call-host", async (orig) => ({
  ...(await orig<typeof import("./chat-voice-call-host")>()),
  useChatVoiceCall: () => ({ startCall: vi.fn(), acceptCall: vi.fn(), declineCall: vi.fn(), inCall: false }),
}));

const reader: User = {
  id: "u-b", email: "b@example.com", display_name: "B",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const WS = "ws1";
const room = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id, kind, name: id, workspace_id: WS, member_user_ids: ["u-a", "u-b"], ...extra,
});
const ROOMS = [
  room("r-ws", "channel", { is_default: true }),
  room("r-dm", "dm", { peer_user_id: "u-a", peer_email: "a@example.com", peer_display_name: "A" }),
  room("r-ch", "channel", { visibility: "public" }),
];
const fileMessage = (roomId: string, id: string) => ({
  id, room_id: roomId, workspace_id: WS, sender_id: "u-a", sender_display_name: "A", kind: "file",
  body: "de-xuat.txt", created_at: "2026-10-16T05:45:00.000Z",
  file: { filename: "de-xuat.txt", content_type: "text/plain", size_bytes: 27 },
});
const MESSAGES: Record<string, ReturnType<typeof fileMessage>[]> = {
  "r-ws": [],
  "r-dm": [fileMessage("r-dm", "m-dm")],
  "r-ch": [fileMessage("r-ch", "m-ch")],
};

// The reader joins the workspace room on first open (ensure-room), so the first list lacks it.
let joined = true;
const later = <T,>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

function serve(path: string): Promise<unknown> {
  const url = path.split("?")[0] ?? "";
  if (url.endsWith(`/workspaces/${WS}/chat/rooms`)) return Promise.resolve({ rooms: joined ? ROOMS : ROOMS.slice(1) });
  if (url.endsWith(`/workspaces/${WS}/chat/room`)) {
    joined = true;
    return later({ workspace_id: WS, room_id: "r-ws" }, 50);
  }
  const around = /\/chat\/rooms\/([^/]+)\/messages\/around\/([^/]+)$/.exec(url);
  if (around) return Promise.resolve({ messages: MESSAGES[around[1] ?? ""] ?? [] });
  const latest = /\/chat\/rooms\/([^/]+)\/messages$/.exec(url);
  if (latest) return Promise.resolve({ messages: MESSAGES[latest[1] ?? ""] ?? [] });
  return Promise.resolve({});
}

function open(query: string, { async = false, cached = false } = {}) {
  const nav = fakeNav(`/acme/team/chat?${query}`);
  if (async) {
    // The web adapter asks the leave guards first and Next commits the URL after
    // its RSC round trip: every move lands later than the call.
    const { push, replace } = nav;
    nav.push = vi.fn((href: string) => void later(null, 300).then(() => push(href)));
    nav.replace = vi.fn((href: string) => void later(null, 300).then(() => replace(href)));
  }
  const page = <ChatPageView workspaceId={WS} currentUserId={reader.id} />;
  render(wrapWithNav(cached ? <AfterRoomsCached>{page}</AfterRoomsCached> : page, nav));
  return nav;
}

/** The voice-call host above the routes reads the rooms first: Chat mounts on a warm cache. */
function AfterRoomsCached({ children }: { children: React.ReactNode }) {
  const { isSuccess } = useChatRooms(WS);
  const [ready, setReady] = useState(false);
  if (isSuccess && !ready) setReady(true);
  return ready ? children : null;
}

async function expectHighlighted(messageId: string) {
  await waitFor(() => expect(document.getElementById(`chat-msg-${messageId}`)).not.toBeNull());
  await waitFor(() => expect(document.getElementById(`chat-msg-${messageId}`)?.className).toMatch(/ring-brand/));
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(reader);
  joined = true;
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => serve(path));
});

describe("ChatPageView ?room=&message= deep link", () => {
  it("opens the DM at the file message and highlights it", async () => {
    const nav = open("room=r-dm&message=m-dm");
    await expectHighlighted("m-dm");
    expect(nav.searchParams.toString()).toBe("room=r-dm");
    expect(screen.getAllByText("de-xuat.txt").length).toBeGreaterThan(0);
  });

  it("opens the channel at the file message and highlights it", async () => {
    const nav = open("room=r-ch&message=m-ch");
    await expectHighlighted("m-ch");
    expect(nav.searchParams.toString()).toBe("room=r-ch");
  });

  it.each(["dm", "ch"])("highlights through the web adapter, whose moves land later (%s)", async (kind) => {
    const nav = open(`room=r-${kind}&message=m-${kind}`, { async: true });
    await expectHighlighted(`m-${kind}`);
    await waitFor(() => expect(nav.searchParams.toString()).toBe(`room=r-${kind}`));
  });

  it.each(["dm", "ch"])("highlights when the rooms are already cached (%s)", async (kind) => {
    open(`room=r-${kind}&message=m-${kind}`, { async: true, cached: true });
    await expectHighlighted(`m-${kind}`);
  });

  it.each(["dm", "ch"])("highlights when the reader joins the workspace room on open (%s)", async (kind) => {
    joined = false;
    open(`room=r-${kind}&message=m-${kind}`, { async: true });
    await expectHighlighted(`m-${kind}`);
  });
});
