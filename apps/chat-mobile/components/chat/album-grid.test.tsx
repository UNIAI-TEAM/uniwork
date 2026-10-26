// An album bubble (album-grid.tsx): each photo a button a screen reader
// reaches, the first saying it starts an album of N photos; an odd count
// gives the first photo the whole row; past four the last tile says how many
// more it hides. A tap opens that photo with a fresh URL (a toast when it
// cannot), a long press or the screen reader's action opens the message menu.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useToastStore } from "@/data/stores/toast-store";
import type { TimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { AlbumGrid } from "./album-grid";
import type { MessageCardContext } from "./message-cards";
import { useChatImageSrc, useFreshChatMediaUrl } from "./use-chat-media";

jest.mock("./use-chat-media", () => ({ useChatImageSrc: jest.fn(), useFreshChatMediaUrl: jest.fn() }));

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

function photo(n: number, filename = `p${n}.jpg`): TimelineMessage {
  const record = ChatMessageSchema.parse({
    id: `m${n}`,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "u2",
    sender_display_name: "Bình",
    kind: "file",
    body: "",
    created_at: "2026-10-22T02:00:00Z",
    file: { filename, content_type: "image/jpeg", url: `https://s/${n}.jpg`, thumb_url: n % 2 ? `https://s/${n}-t.jpg` : "" },
  });
  return { id: record.id, sender: "u2", body: "", ts: 0, record };
}

const photos = (count: number) => Array.from({ length: count }, (_, i) => photo(i + 1));
const tile = (name: string) => screen.getByRole("imagebutton", { name: new RegExp(viText("chat.message_list.file_open_named", { name })) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useChatImageSrc).mockImplementation((_ws, _room, _id, url) => url ?? null);
  jest.mocked(useFreshChatMediaUrl).mockReturnValue(fresh);
  fresh.mockResolvedValue("https://s/fresh");
});
afterEach(async () => {
  await act(() => useToastStore.getState().clear());
});

describe("AlbumGrid", () => {
  it("shows four of six photos, the first naming the album, the last how many more it hides", async () => {
    await render(<AlbumGrid photos={photos(6)} ctx={ctx} onLongPress={jest.fn()} />);
    expect(screen.getAllByRole("imagebutton")).toHaveLength(4);
    expect(tile("p1.jpg").props.accessibilityLabel).toBe(`${viText("chat.album_aria", { count: 6 })}, ${viText("chat.message_list.file_open_named", { name: "p1.jpg" })}`);
    expect(tile("p4.jpg").props.accessibilityLabel).toBe(
      `${viText("chat.message_list.file_open_named", { name: "p4.jpg" })}, ${viText("chat.info_panel.more_photos", { count: 2 })}`,
    );
    expect(screen.getByText("+2")).toBeOnTheScreen();
  });

  it("gives the first of an odd count the whole row, and leaves out a message without a file", async () => {
    const text: TimelineMessage = { id: "t1", sender: "u2", body: "caption", ts: 0 };
    await render(<AlbumGrid photos={[...photos(3), text]} ctx={ctx} onLongPress={jest.fn()} />);
    expect(screen.getAllByRole("imagebutton")).toHaveLength(3);
    expect(tile("p1.jpg").props.accessibilityLabel).toMatch(new RegExp(`^${viText("chat.album_aria", { count: 3 })}`));
    expect(tile("p2.jpg").props.accessibilityLabel).toBe(viText("chat.message_list.file_open_named", { name: "p2.jpg" }));
  });

  it("lays two photos side by side, a grey tile while one has no URL, and names an untitled one", async () => {
    jest.mocked(useChatImageSrc).mockReturnValueOnce(null);
    await render(<AlbumGrid photos={[photo(1), photo(2, "")]} ctx={ctx} onLongPress={jest.fn()} />);
    expect(screen.getAllByRole("imagebutton")).toHaveLength(2);
    expect(tile(viText("chat.media_image"))).toBeOnTheScreen();
  });

  it("opens the tapped photo with a fresh URL, and offers the message menu by long press and to a screen reader", async () => {
    const onLongPress = jest.fn();
    await render(<AlbumGrid photos={photos(2)} ctx={ctx} onLongPress={onLongPress} />);
    await fireEvent.press(tile("p2.jpg"));
    await waitFor(() => expect(ctx.onOpenImage).toHaveBeenCalledWith("https://s/fresh", "p2.jpg", "m2"));
    const pick = fresh.mock.calls[0]?.[2] as (m: { file?: { url?: string } }) => string | undefined;
    expect(pick({ file: { url: "u" } })).toBe("u");
    await fireEvent(tile("p1.jpg"), "longPress");
    await fireEvent(tile("p1.jpg"), "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
    expect(onLongPress).toHaveBeenCalledTimes(2);
  });

  it("says when a photo cannot be opened", async () => {
    fresh.mockRejectedValueOnce(new Error("unavailable"));
    await render(<AlbumGrid photos={photos(2)} ctx={ctx} onLongPress={jest.fn()} />);
    await fireEvent.press(tile("p1.jpg"));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("chat.media_unavailable", { name: "p1.jpg" })]));
  });
});
