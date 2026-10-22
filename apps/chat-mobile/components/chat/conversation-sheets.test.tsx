// The conversation's sheets and the composer banner, wired (conversation.tsx; audit "thin-coverage-core-chat": the
// screen's handlers were the least tested part of the busiest screen): a sticker picked from the "+" menu is sent as
// the web sends it, a reminder created there is queued as a reminder message, "More reactions" reacts with the emoji
// picked, a reply and an edit put their banner over the composer and cancel back to a plain composer, and an edit
// saved goes through the offline edit path.
import { ChatMessageSchema, ChatRoomSchema, type ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { chatApi } from "@/data/chat-api";
import * as chatSend from "@/data/chat-send";
import * as pendingOps from "@/data/pending-ops";
import { toTimelineMessage, type TimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { Conversation } from "./conversation";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useRoomContext } from "./use-room-context";

jest.mock("./connection-banner", () => ({ ConnectionBanner: () => null }));
jest.mock("./swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: ReactNode }) => children }));
jest.mock("./use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };
const T0 = Date.UTC(2026, 9, 21, 2, 0);
const record = (id: string, sender: string, minute: number, body: string): ChatMessageRecord =>
  ChatMessageSchema.parse({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: sender,
    sender_display_name: sender === "U2" ? "Bình" : "Tôi",
    kind: "text",
    body,
    created_at: new Date(T0 + minute * 60_000).toISOString(),
  });
const history = [record("m1", "U2", 0, "Họp lúc 3 giờ"), record("m2", "ME", 1, "Mình tới ngay")];

function Screen() {
  const room = useRoomContext(chat, "r1");
  const [atLatest, setAtLatest] = useState(true);
  const messages: TimelineMessage[] = history.map(toTimelineMessage);
  return (
    <Conversation
      chat={chat}
      roomId="r1"
      room={room}
      header={null}
      messages={messages}
      loading={false}
      loadingOlder={false}
      jumpTo={null}
      onQuoteJump={jest.fn()}
      atLatest={atLatest}
      onAtLatestChange={setAtLatest}
      historyComplete
    />
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const os = Platform.OS;
// Android runs a sheet's choice at once; iOS waits for the closed modal's onDismiss (action-sheet.tsx › useAfterDismiss).
beforeAll(() => {
  Platform.OS = "android";
});
afterAll(() => {
  Platform.OS = os;
});

beforeEach(() => {
  const group = ChatRoomSchema.parse({ id: "r1", kind: "group", name: "Thiết kế", workspace_id: "w1", member_count: 2, member_user_ids: ["ME", "U2"] });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([group]);
  jest.spyOn(chatApi, "listRoomMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listFollowUps").mockResolvedValue([]);
  jest.spyOn(chatApi, "listRoomMessageLinks").mockResolvedValue([]);
  jest.spyOn(chatApi, "listExpressions").mockResolvedValue([{ id: "s1", label: "wave", url: "https://media.tenor.com/w.gif", previewUrl: "https://media.tenor.com/w.gif" }]);
  jest.spyOn(chatSend, "sendChatMessage").mockResolvedValue(undefined as never);
  jest.spyOn(pendingOps, "toggleReaction").mockResolvedValue(undefined as never);
  jest.spyOn(pendingOps, "editMessage").mockResolvedValue(undefined as never);
});
afterEach(() => jest.restoreAllMocks());

const openPlusMenu = async () => fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_attach") }));
/** The bubble a screen reader reaches for a message: its label carries the body (an own one adds its receipt after). */
const longPress = async (body: string) => fireEvent(screen.getByLabelText(new RegExp(body)), "longPress");
const sent = () => jest.mocked(chatSend.sendChatMessage).mock.calls.map(([, input]) => input);

describe("the conversation's sheets", () => {
  it("sends a sticker picked from the + menu as the web sends it", async () => {
    await render(<Screen />);
    await settle();
    await openPlusMenu();
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.expression_tab_sticker")} · ${viText("chat.expression_tab_gif")}` }));
    await fireEvent.press(await screen.findByRole("button", { name: "wave" }));
    expect(sent()).toEqual([expect.objectContaining({ roomId: "r1", body: "![sticker:wave](https://media.tenor.com/w.gif)" })]);
  });

  it("queues a reminder created from the + menu as a reminder message", async () => {
    await render(<Screen />);
    await settle();
    await openPlusMenu();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_create_reminder") }));
    await fireEvent.changeText(await screen.findByLabelText(viText("chat.reminder_body_label")), "  Gọi khách  ");
    await fireEvent.press(screen.getByTestId("reminder-create"));
    expect(sent()).toEqual([expect.objectContaining({ body: "", reminder: expect.objectContaining({ body: "Gọi khách", repeat: "none" }) })]);
  });

  it("reacts with an emoji picked from More reactions", async () => {
    await render(<Screen />);
    await settle();
    await longPress("Họp lúc 3 giờ");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.action_react_more") }));
    await fireEvent.press(await screen.findByRole("button", { name: "🚀" }));
    expect(pendingOps.toggleReaction).toHaveBeenCalledWith(expect.anything(), "w1", "r1", "m1", "🚀", "ME");
  });
});

describe("the composer banner", () => {
  it("quotes the message replied to, and cancels back to a plain composer", async () => {
    await render(<Screen />);
    await settle();
    await longPress("Họp lúc 3 giờ");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.action_reply") }));
    expect(screen.getByText(viText("chat.replying_to", { preview: "Họp lúc 3 giờ" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.cancel_reply") }));
    expect(screen.queryByText(viText("chat.replying_to", { preview: "Họp lúc 3 giờ" }))).toBeNull();
  });

  it("edits an own message: cancel leaves it, save sends the new text through the offline edit", async () => {
    await render(<Screen />);
    await settle();
    await longPress("Mình tới ngay");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.action_edit") }));
    expect(screen.getByText(viText("chat.edit_dialog_title"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(screen.queryByText(viText("chat.edit_dialog_title"))).toBeNull();
    await longPress("Mình tới ngay");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.action_edit") }));
    await fireEvent.changeText(screen.getByTestId("composer-input"), "Mình tới muộn 5 phút");
    await fireEvent.press(screen.getByTestId("composer-send"));
    expect(pendingOps.editMessage).toHaveBeenCalledWith(expect.anything(), "w1", "r1", "m2", "Mình tới muộn 5 phút", "ME");
    expect(screen.queryByText(viText("chat.edit_dialog_title"))).toBeNull();
  });
});
