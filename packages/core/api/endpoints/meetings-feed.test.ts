import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { listMeetingChatPage, listTranscriptPage } from "./meetings-feed";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const msg = {
  id: "c1",
  meeting_id: "m1",
  sender_identity: "uw_participant_p1",
  sender_name: "An",
  message: "hi",
  sent_at: "2026-08-29T02:00:00Z",
};
const seg = { id: "s1", meeting_id: "m1", text: "hi", spoken_at: "2026-08-29T02:00:00Z" };

const url = (i: number) => String(vi.mocked(fetch).mock.calls[i]![0]);

describe("meeting feed endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("reads a chat page with its cursors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ messages: [msg], older_cursor: "1.a", after_cursor: "2.c1", has_more_after: false }),
    );
    expect(await listMeetingChatPage("m1")).toEqual({
      items: [msg],
      olderCursor: "1.a",
      afterCursor: "2.c1",
      hasMoreAfter: false,
    });
    expect(url(0)).toBe("http://api.test/api/v1/meetings/m1/chat");
  });

  it("puts before, after and limit on the query string", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ messages: [] }));
    await listMeetingChatPage("m1", { before: "1.a", limit: 50 });
    await listTranscriptPage("m 1", { after: "2.b" });
    expect(url(0)).toBe("http://api.test/api/v1/meetings/m1/chat?before=1.a&limit=50");
    expect(url(1)).toBe("http://api.test/api/v1/meetings/m%201/transcript?after=2.b");
  });

  it("reads an old server's bare list as a page without cursors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ segments: [seg] }));
    expect(await listTranscriptPage("m1")).toEqual({
      items: [seg],
      olderCursor: "",
      afterCursor: "",
      hasMoreAfter: false,
    });
  });

  it("degrades on a malformed response instead of throwing", async () => {
    // One bad row is dropped, the rest of the page stays.
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [{ id: 1 }, msg], older_cursor: 7, has_more_after: "x" }));
    expect(await listMeetingChatPage("m1")).toEqual({
      items: [msg],
      olderCursor: "",
      afterCursor: "",
      hasMoreAfter: false,
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ segments: "nope" }));
    expect((await listTranscriptPage("m1")).items).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json(null));
    expect(await listMeetingChatPage("m1")).toEqual({
      items: [],
      olderCursor: "",
      afterCursor: "",
      hasMoreAfter: false,
    });
  });
});
