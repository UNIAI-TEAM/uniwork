import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { SegmentLink } from "@uniwork/core/meetings/feed";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomTranscript } from "./meeting-room-transcript";

const line = (id: string, over: Partial<MeetingTranscriptSegment> = {}): MeetingTranscriptSegment => ({
  id,
  meeting_id: "m1",
  participant_id: "p-minh",
  speaker_name: "Minh",
  text: `Câu ${id}`,
  spoken_at: "2026-10-01T02:00:00Z",
  ...over,
});

/** jsdom has no layout: give the scroll area a height, a content height and a settable scrollTop. */
function stubScroll(el: HTMLElement) {
  const box = { height: 0, top: 0 };
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => box.height });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => box.top,
    set: (v: number) => {
      box.top = v;
    },
  });
  return box;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

type Props = Parameters<typeof MeetingRoomTranscript>[0];
const view = (props: Partial<Props> & Pick<Props, "segments">, qc = client()) =>
  wrapWithNav(<MeetingRoomTranscript meetingId="m1" emptyText="" {...props} />, undefined, qc);

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ segments: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingRoomTranscript", () => {
  it("follows new lines at the bottom, stays put once the reader scrolls up, and keeps their place when an older page lands", () => {
    const qc = client();
    const { rerender } = render(view({ segments: [line("a"), line("b")] }, qc));
    const el = screen.getByTestId("meeting-room-transcript");
    const box = stubScroll(el);
    box.height = 1000;
    box.top = 600;
    fireEvent.scroll(el);

    box.height = 1100;
    rerender(view({ segments: [line("a"), line("b"), line("c")] }, qc));
    expect(box.top).toBe(1100);

    box.top = 200;
    fireEvent.scroll(el);
    box.height = 1200;
    rerender(view({ segments: [line("a"), line("b"), line("c"), line("d")] }, qc));
    expect(box.top).toBe(200);

    box.height = 1500;
    rerender(view({ segments: [line("z"), line("a"), line("b"), line("c"), line("d")] }, qc));
    expect(box.top).toBe(500);
  });

  it("is a keyboard-scrollable region named for the transcript", () => {
    render(view({ segments: [line("a")] }));
    const region = screen.getByRole("region", { name: "Lời thoại" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("groups consecutive lines of one speaker under one face and name", () => {
    render(
      view({
        segments: [
          line("s1"),
          line("s2"),
          line("s3"),
          line("s4", { participant_id: "p-lan", speaker_name: "Lan" }),
          line("s5"),
          line("s6", { participant_id: undefined, speaker_name: undefined, speaker_label: "room:2", room_speaker: 2 }),
        ],
      }),
    );
    const groups = within(screen.getByTestId("meeting-room-transcript")).getAllByRole("listitem");
    expect(groups).toHaveLength(4);
    expect(within(groups[0]!).getByText("Minh")).toBeInTheDocument();
    expect(within(groups[0]!).getByText("Câu s1")).toBeInTheDocument();
    expect(within(groups[0]!).getByText("Câu s3")).toBeInTheDocument();
    expect(screen.getAllByText("Minh")).toHaveLength(2);
    // A room-mic speaker nobody named is worded in the reader's language.
    expect(within(groups[3]!).getByText("Hội trường · Người nói 2")).toBeInTheDocument();
  });

  it("puts a chip under a line that became a decision or an item, a button only when it can open it", () => {
    const links = new Map<string, SegmentLink[]>([
      ["s1", [{ kind: "decision" }]],
      ["s2", [{ kind: "task", owner: "Minh" }]],
      ["s3", [{ kind: "task", owner: null }]],
    ]);
    const segments = [line("s1"), line("s2"), line("s3")];
    const { unmount } = render(view({ segments, links }));
    expect(screen.getByText("Đã thành quyết định")).toBeInTheDocument();
    expect(screen.getByText("Việc mới · Minh")).toBeInTheDocument();
    expect(screen.getByText("Việc mới")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đã thành quyết định" })).toBeNull();
    unmount();

    const onOpenLink = vi.fn();
    render(view({ segments, links, onOpenLink }));
    fireEvent.click(screen.getByRole("button", { name: "Đã thành quyết định" }));
    fireEvent.click(screen.getByRole("button", { name: "Việc mới · Minh" }));
    expect(onOpenLink.mock.calls).toEqual([["decision"], ["task"]]);
  });

  describe("a focused line", () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      scrollIntoView.mockReset();
      Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    it("scrolls into view and is marked for two seconds", () => {
      vi.useFakeTimers();
      render(view({ segments: [line("s1"), line("s2"), line("s3")], focusSegmentId: "s3" }));
      const target = screen.getByText("Câu s3");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(scrollIntoView.mock.contexts[0]).toBe(target);
      expect(target).toHaveClass("bg-brand-subtle");
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(target).not.toHaveClass("bg-brand-subtle");
    });

    it("loses its mark when the focus is dropped before the two seconds are up", () => {
      vi.useFakeTimers();
      const qc = client();
      const segments = [line("s1"), line("s2"), line("s3")];
      const { rerender } = render(view({ segments, focusSegmentId: "s3" }, qc));
      const target = screen.getByText("Câu s3");
      act(() => {
        vi.advanceTimersByTime(500);
      });
      rerender(view({ segments, focusSegmentId: null }, qc));
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(target).not.toHaveClass("bg-brand-subtle");
    });
  });

  it("filters lines by the search, ignoring tone marks, and marks what matched", () => {
    render(
      view({
        searchOpen: true,
        segments: [
          line("s1", { text: "Lỗi thanh toán QR trên máy Sunmi" }),
          line("s2", { text: "Marketing giữ 120 triệu" }),
          line("s3", { text: "Đồng ý lùi ngày" }),
        ],
      }),
    );
    const search = screen.getByRole("textbox", { name: "Tìm trong lời thoại" });
    fireEvent.change(search, { target: { value: "qr" } });
    expect(screen.queryByText(/Marketing/)).toBeNull();
    expect(screen.getByText("QR").tagName).toBe("MARK");

    fireEvent.change(search, { target: { value: "thanh toan" } });
    expect(screen.getByText("thanh toán").tagName).toBe("MARK");

    fireEvent.change(search, { target: { value: "dong y" } });
    expect(screen.getByText("Đồng ý").tagName).toBe("MARK");
    expect(screen.queryByText(/thanh toán/)).toBeNull();
  });

  it("keeps the reader's place when an older page lands after the search shrank the list", () => {
    const qc = client();
    const segments = [line("a", { text: "QR một" }), line("b", { text: "khác" }), line("c", { text: "QR hai" })];
    const { rerender } = render(view({ searchOpen: true, segments }, qc));
    const el = screen.getByTestId("meeting-room-transcript");
    const box = stubScroll(el);
    box.height = 1000;
    box.top = 100;
    fireEvent.scroll(el);

    box.height = 300;
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm trong lời thoại" }), { target: { value: "qr" } });
    expect(box.top).toBe(100);

    box.height = 500;
    rerender(view({ searchOpen: true, segments: [line("z", { text: "QR cũ" }), ...segments] }, qc));
    expect(box.top).toBe(300);
  });

  it("offers the jump only for a new line the search shows", () => {
    const qc = client();
    const segments = [line("a", { text: "QR một" }), line("b", { text: "khác" })];
    const { rerender } = render(view({ searchOpen: true, segments }, qc));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm trong lời thoại" }), { target: { value: "qr" } });
    const el = screen.getByTestId("meeting-room-transcript");
    const box = stubScroll(el);
    box.height = 1000;
    box.top = 100;
    fireEvent.scroll(el);

    const more = [...segments, line("c", { text: "không khớp" })];
    rerender(view({ searchOpen: true, segments: more }, qc));
    expect(screen.queryByRole("button", { name: "Về mới nhất" })).toBeNull();

    rerender(view({ searchOpen: true, segments: [...more, line("d", { text: "QR mới" })] }, qc));
    expect(screen.getByRole("button", { name: "Về mới nhất" })).toBeInTheDocument();
  });

  it("offers a jump to the latest line when one arrives while the reader is scrolled up, without moving them", () => {
    const qc = client();
    const { rerender } = render(view({ segments: [line("a"), line("b")] }, qc));
    const el = screen.getByTestId("meeting-room-transcript");
    const box = stubScroll(el);
    box.height = 1000;
    box.top = 200;
    fireEvent.scroll(el);
    expect(screen.queryByRole("button", { name: "Về mới nhất" })).toBeNull();

    box.height = 1100;
    rerender(view({ segments: [line("a"), line("b"), line("c", { participant_id: "p-lan", speaker_name: "Lan" })] }, qc));
    expect(box.top).toBe(200);
    fireEvent.click(screen.getByRole("button", { name: "Về mới nhất" }));
    expect(box.top).toBe(1100);
    // The pill leaves with the click; focus stays in the transcript instead of falling to the page.
    expect(el).toHaveFocus();
    fireEvent.scroll(el);
    expect(screen.queryByRole("button", { name: "Về mới nhất" })).toBeNull();
  });

  it("shows who is speaking while their newest line is under ten seconds old", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-01T02:00:05Z"));
    render(view({ segments: [line("a", { participant_id: "p-lan", speaker_name: "Lan" }), line("b")] }));
    expect(screen.getByRole("img", { name: "đang nói" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryByRole("img", { name: "đang nói" })).toBeNull();
  });
});
