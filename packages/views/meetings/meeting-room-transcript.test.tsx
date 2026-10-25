import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomTranscript } from "./meeting-room-transcript";

const line = (id: string): MeetingTranscriptSegment => ({
  id,
  meeting_id: "m1",
  speaker_name: "Minh",
  text: `Câu ${id}`,
  spoken_at: "2026-10-01T02:00:00Z",
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

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ segments: [] });
});

describe("MeetingRoomTranscript", () => {
  it("follows new lines at the bottom, stays put once the reader scrolls up, and keeps their place when an older page lands", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (segments: MeetingTranscriptSegment[]) =>
      wrapWithNav(<MeetingRoomTranscript meetingId="m1" segments={segments} emptyText="" />, undefined, client);
    const { rerender } = render(view([line("a"), line("b")]));
    const el = screen.getByTestId("meeting-room-transcript");
    const box = stubScroll(el);
    box.height = 1000;
    box.top = 600;
    fireEvent.scroll(el);

    box.height = 1100;
    rerender(view([line("a"), line("b"), line("c")]));
    expect(box.top).toBe(1100);

    box.top = 200;
    fireEvent.scroll(el);
    box.height = 1200;
    rerender(view([line("a"), line("b"), line("c"), line("d")]));
    expect(box.top).toBe(200);

    box.height = 1500;
    rerender(view([line("z"), line("a"), line("b"), line("c"), line("d")]));
    expect(box.top).toBe(500);
  });
});
