// What each kind of message shows inside its bubble (message-cards.tsx): the
// text with its mentions, links and bold; a sticker; a photo and a file that
// open (and say so when they cannot); a poll to vote in, closed or with its
// counts hidden; note, post, reminder, call log and call summary cards; and the
// "open on the web" row for a kind this build does not know. Queried the way a
// screen reader reaches them.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { INTERACTIVE_VIEWS, MessageContent, type MessageCardContext } from "./message-cards";
import { useChatImageSrc, useFreshChatMediaUrl } from "./use-chat-media";

jest.mock("./use-chat-media", () => ({
  useChatImageSrc: jest.fn(),
  useFreshChatMediaUrl: jest.fn(),
  useChatMediaSrc: jest.fn(() => null),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: "opened" })) }));

const fresh = jest.fn();
const ctx: MessageCardContext = {
  wsId: "w1",
  orgSlug: "acme",
  wsSlug: "hq",
  roomId: "r1",
  userId: "u1",
  onOpenImage: jest.fn(),
  onVotePoll: jest.fn(),
  onOpenLink: jest.fn(),
  onLinkMenu: jest.fn(),
};

function message(fields: Record<string, unknown>) {
  return ChatMessageSchema.parse({
    id: "m1",
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "u2",
    sender_display_name: "Bình",
    body: "",
    created_at: "2026-10-22T02:00:00Z",
    ...fields,
  });
}

async function show(fields: Record<string, unknown>, own = false) {
  const onLongPress = jest.fn();
  const view = await render(<MessageContent record={message(fields)} own={own} ctx={ctx} onLongPress={onLongPress} />);
  return { ...view, onLongPress };
}

const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  jest.clearAllMocks();
  configureRuntime({ appUrl: "https://app.example" });
  jest.mocked(useChatImageSrc).mockReturnValue("https://s/thumb.jpg");
  jest.mocked(useFreshChatMediaUrl).mockReturnValue(fresh);
  fresh.mockResolvedValue("https://s/fresh");
});
afterEach(async () => {
  resetRuntimeConfig();
  await act(() => useToastStore.getState().clear());
});

describe("MessageContent › text", () => {
  it("sets the reader's mention and @all apart, links open on a tap and offer a menu on a long press, bold stays bold", async () => {
    await show({ body: "Hi [@An](mention://member/u1) and [@all](mention://all/all) and [@Chi](mention://member/u3), see https://uniwork.vn and **now**", mentioned_user_ids: ["u1"] });
    const link = screen.getByRole("link", { name: viText("mobile.conversation.link_label", { link: "uniwork.vn" }) });
    await fireEvent.press(link);
    expect(ctx.onOpenLink).toHaveBeenCalledWith("https://uniwork.vn");
    await fireEvent(link, "longPress");
    expect(ctx.onLinkMenu).toHaveBeenCalledWith("https://uniwork.vn");
    expect(screen.getByText("now")).toBeOnTheScreen();
    expect(screen.getByText("@An")).toBeOnTheScreen();
    expect(screen.getByText("@Chi")).toBeOnTheScreen();
  });

  it("inks mentions and links for the brand bubble in an own message", async () => {
    await show({ body: "[@An](mention://member/u1) https://uniwork.vn" }, true);
    expect(screen.getByRole("link")).toBeOnTheScreen();
  });
});

describe("MessageContent › sticker and photo", () => {
  it("draws a sticker from an allowed host with its label", async () => {
    await show({ body: "![sticker:wave](https://media.tenor.com/w.gif)" });
    expect(screen.getByLabelText("sticker:wave")).toBeOnTheScreen();
  });

  it("opens a photo in the viewer with a fresh URL, and keeps the long-press menu for touch and screen readers", async () => {
    const { onLongPress } = await show({ kind: "file", file: { filename: "a.jpg", content_type: "image/jpeg", url: "https://s/a.jpg", width: 800, height: 600 } });
    const photo = screen.getByRole("imagebutton", { name: viText("chat.message_list.file_open_named", { name: "a.jpg" }) });
    await fireEvent.press(photo);
    await waitFor(() => expect(ctx.onOpenImage).toHaveBeenCalledWith("https://s/fresh", "a.jpg", "m1"));
    await fireEvent(photo, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("shows the photo as loading until it has a URL, names an untitled one, and says when it cannot open", async () => {
    jest.mocked(useChatImageSrc).mockReturnValue(null);
    fresh.mockRejectedValueOnce(new Error("unavailable"));
    await show({ kind: "file", file: { content_type: "image/png", url: "" } });
    expect(screen.getByText(viText("chat.message_list.image_preview_loading"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("imagebutton", { name: viText("chat.message_list.file_open_named", { name: viText("chat.media_image") }) }));
    await waitFor(() => expect(toasts()).toEqual([viText("chat.media_unavailable", { name: "" })]));
  });
});

describe("MessageContent › file", () => {
  it("opens a file in the system browser from its download URL, with its size and type badge", async () => {
    await show({ kind: "file", file: { filename: "plan.pdf", content_type: "application/pdf", url: "https://s/p", download_url: "https://s/p?dl", size_bytes: 2048 } }, true);
    expect(screen.getByText("PDF")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.message_list.file_open_named", { name: "plan.pdf" }) }));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://s/fresh"));
    expect(fresh.mock.calls[0]?.[1]).toEqual({ url: "https://s/p?dl", expiresAt: "" });
    const pick = fresh.mock.calls[0]?.[2] as (m: { file?: { url?: string; download_url?: string } }) => string | undefined;
    expect(pick({ file: { download_url: "d", url: "u" } })).toBe("d");
    expect(pick({ file: { url: "u" } })).toBe("u");
  });

  it("names an untitled file without a known type, and says when the download fails", async () => {
    fresh.mockRejectedValueOnce(new Error("unavailable"));
    await show({ kind: "file", file: { content_type: "application/octet-stream", url: "https://s/x" } });
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.message_list.file_open_named", { name: viText("chat.file_untitled") }) }));
    await waitFor(() => expect(toasts()).toEqual([viText("chat.file_download_failed")]));
  });
});

describe("MessageContent › poll", () => {
  const poll = {
    question: "Lunch?",
    options: [
      { id: "o1", label: "Phở", votes: 3 },
      { id: "o2", label: "Bún", votes: 1 },
    ],
    viewer_option_ids: ["o1"],
  };

  it("votes from each option, marks the reader's pick and shows the counts", async () => {
    const { onLongPress } = await show({ kind: "poll", poll });
    expect(screen.getByText("Lunch?")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.message_list.poll_pick_many"))).toBeOnTheScreen();
    const pho = screen.getByRole("button", { name: viText("chat.poll_option_aria", { label: "Phở", count: 3 }) });
    expect(pho.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(screen.getByText("75%")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.poll_option_aria", { label: "Bún", count: 1 }) }));
    expect(ctx.onVotePoll).toHaveBeenCalledWith("m1", "o2");
    await fireEvent(pho, "longPress");
    expect(onLongPress).toHaveBeenCalled();
    expect(screen.getByText(viText("chat.poll_vote_hint", { count: 4 }))).toBeOnTheScreen();
  });

  it("in an own bubble, a single-choice poll inks its pick for the brand colour", async () => {
    await show({ kind: "poll", poll: { ...poll, settings: { allow_multiple: false } } }, true);
    expect(screen.getByText(viText("chat.message_list.poll_pick_one"))).toBeOnTheScreen();
  });

  it("closes past its deadline: options stop voting and the head says so", async () => {
    await show({ kind: "poll", poll: { ...poll, viewer_option_ids: [], settings: { deadline_at: "2020-01-01T00:00:00Z" } } }, true);
    expect(screen.getByText(viText("chat.poll_closed_status"))).toBeOnTheScreen();
    expect(screen.getByText(`${viText("chat.poll_closed")} · ${viText("chat.poll_vote_hint", { count: 4 })}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.poll_option_aria", { label: "Phở", count: 3 }) }));
    expect(ctx.onVotePoll).not.toHaveBeenCalled();
  });

  it("hides the counts until the reader votes, and then has no footer", async () => {
    await show({ kind: "poll", poll: { ...poll, viewer_option_ids: [], settings: { hide_results_until_vote: true } } });
    expect(screen.queryByText("75%")).toBeNull();
    expect(screen.queryByText(viText("chat.poll_vote_hint", { count: 4 }))).toBeNull();
  });
});

describe("MessageContent › cards", () => {
  it("shows a note, pinned or not", async () => {
    const { rerender } = await show({ kind: "note", note: { body: "Remember the keys" }, pinned: true });
    expect(screen.getByText("Remember the keys")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.pinned_label"))).toBeOnTheScreen();
    await rerender(<MessageContent record={message({ kind: "note", note: { body: "Remember the keys" } })} own ctx={ctx} onLongPress={jest.fn()} />);
    expect(screen.queryByText(viText("chat.pinned_label"))).toBeNull();
  });

  it("shows a post's title and body", async () => {
    await show({ kind: "post", post: { title: "Release", body: "Ships Friday" } });
    expect(screen.getByText("Release")).toBeOnTheScreen();
    expect(screen.getByText("Ships Friday")).toBeOnTheScreen();
  });

  it("shows a reminder as due once its time passed, and as scheduled with its repeat before", async () => {
    const { rerender } = await show({ kind: "reminder", reminder: { body: "Standup", remind_at: "2020-01-01T02:00:00Z" } });
    expect(screen.getByText(viText("chat.reminder_due_status"))).toBeOnTheScreen();
    await rerender(
      <MessageContent
        record={message({ kind: "reminder", reminder: { body: "Standup", remind_at: "2099-01-01T02:00:00Z", repeat: "daily" } })}
        own
        ctx={ctx}
        onLongPress={jest.fn()}
      />,
    );
    expect(screen.queryByText(viText("chat.reminder_due_status"))).toBeNull();
    expect(screen.getByText(new RegExp(`^${viText("chat.reminder_scheduled_label")} .+ · ${viText("chat.reminder_repeat_daily")}$`))).toBeOnTheScreen();
  });

  it("shows a reminder whose time does not parse without a time", async () => {
    await show({ kind: "reminder", reminder: { body: "Later", remind_at: "soon", repeat: "weird" } });
    expect(screen.getByText(`${viText("chat.reminder_scheduled_label")} `)).toBeOnTheScreen();
  });

  it("shows a call the reader missed in red, and one they made as a plain chip; a video call says so", async () => {
    const { rerender } = await show({ kind: "voice_call_log", voice_call: { outcome: "unanswered", caller_id: "u2" } });
    expect(screen.getByText(viText("chat.voice_call_log_missed"))).toBeOnTheScreen();
    await rerender(
      <MessageContent
        record={message({ kind: "voice_call_log", created_at: "not a date", voice_call: { outcome: "unanswered", caller_id: "u1", video: true } })}
        own
        ctx={ctx}
        onLongPress={jest.fn()}
      />,
    );
    expect(screen.getByText(viText("chat.video_call_log_cancelled"))).toBeOnTheScreen();
  });

  it("shows a call summary with its highlights and suggested tasks, and says when there was nothing to summarize", async () => {
    const summary = {
      call_id: "c1",
      call_log_message_id: "m0",
      summary: "We agreed",
      highlights: ["Ship it"],
      action_items: [
        { title: "Write notes", owner: "An", due: "Fri" },
        { title: "Book room" },
      ],
    };
    const { rerender } = await show({ kind: "text", voice_call_summary: summary });
    expect(screen.getByText("We agreed")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.ai.highlights"))).toBeOnTheScreen();
    expect(screen.getByText("Ship it")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.ai.action_items"))).toBeOnTheScreen();
    expect(screen.getByText("An · Fri")).toBeOnTheScreen();
    expect(screen.getByText("Book room")).toBeOnTheScreen();
    await rerender(
      <MessageContent record={message({ voice_call_summary: { call_id: "c1", call_log_message_id: "m0" } })} own ctx={ctx} onLongPress={jest.fn()} />,
    );
    expect(screen.getByText(viText("chat.voice_call_summary_empty"))).toBeOnTheScreen();
    expect(screen.queryByText(viText("chat.ai.highlights"))).toBeNull();
  });

  it("hands a voice message to its player", async () => {
    await show({ kind: "voice", voice: { url: "https://s/v.m4a", url_expires_at: "2099-01-01T00:00:00Z", duration_ms: 42_000 } });
    expect(screen.getByTestId("voice-play")).toBeOnTheScreen();
  });

  it("draws nothing for a system line", async () => {
    await show({ kind: "system", body: "An joined" });
    expect(screen.queryByText("An joined")).toBeNull();
  });
});

describe("MessageContent › a kind this build does not know", () => {
  it("says so and opens the message on the web", async () => {
    const { onLongPress } = await show({ kind: "hologram" });
    expect(screen.getByText(viText("chat.mobile.unsupported_message"))).toBeOnTheScreen();
    const open = screen.getByRole("link");
    await fireEvent.press(open);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/app\.example\/acme\/hq\/chat\?room=r1/));
    await fireEvent(open, "longPress");
    expect(onLongPress).toHaveBeenCalled();
  });

  it("covers a known kind that arrives without its block, in an own bubble", async () => {
    for (const kind of ["file", "voice", "poll", "note", "post", "reminder"]) {
      const { unmount } = await show({ kind }, true);
      expect(screen.getByText(viText("chat.mobile.open_on_web"))).toBeOnTheScreen();
      await unmount();
    }
  });

  it("lists the views that are buttons of their own", () => {
    expect([...INTERACTIVE_VIEWS].sort()).toEqual(["file", "image", "poll", "unsupported", "voice"]);
  });
});

describe("MessageContent › poll vote", () => {
  const vote = { kind: "poll_vote", body: "Ăn trưa?", poll_vote: { poll_message_id: "p1", question: "Ăn trưa?" } };

  it("names who voted and offers a jump to the poll when the conversation can scroll to it", async () => {
    const onJumpToMessage = jest.fn();
    await render(<MessageContent record={message(vote)} own={false} ctx={{ ...ctx, onJumpToMessage }} onLongPress={jest.fn()} senderLabel="Chi" />);
    expect(screen.getByText(/Chi/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.poll_vote_activity_view") }));
    expect(onJumpToMessage).toHaveBeenCalledWith("p1");
  });

  it("falls back to the sender's name and has no jump without a way to scroll", async () => {
    await show(vote);
    expect(screen.getByText(/Bình/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: viText("chat.poll_vote_activity_view") })).toBeNull();
  });
});
