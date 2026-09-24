import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  archiveChatChannel,
  createChatChannel,
  joinChatChannel,
  listChatChannels,
  listProjectChatChannels,
  unarchiveChatChannel,
  updateChatChannel,
} from "./chat-channels";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sampleChannel = {
  id: "01CHAN",
  kind: "channel",
  name: "marketing",
  workspace_id: "ws1",
  member_user_ids: ["u1"],
  visibility: "public",
  topic: "Q3",
  project_id: "01PROJ",
  is_default: false,
};

describe("chat channel endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("createChatChannel degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(
      await createChatChannel("ws1", { name: "marketing", visibility: "public" }),
    ).toBeNull();
  });

  it("createChatChannel returns room on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ room: sampleChannel }));
    const room = await createChatChannel("ws1", {
      name: "marketing",
      visibility: "public",
      topic: "Q3",
      project_id: "01PROJ",
      member_user_ids: ["u2"],
    });
    expect(room?.id).toBe("01CHAN");
    expect(room?.kind).toBe("channel");
    expect(room?.visibility).toBe("public");
    expect(room?.is_default).toBe(false);
  });

  it("listChatChannels degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listChatChannels("ws1", { scope: "mine" })).toEqual([]);
  });

  it("listChatChannels passes scope, project_id, and q", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ rooms: [sampleChannel] }));
    const rooms = await listChatChannels("ws1", {
      scope: "discoverable",
      project_id: "01PROJ",
      q: "mark",
    });
    expect(rooms).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/chat/channels?scope=discoverable&project_id=01PROJ&q=mark",
    );
  });

  it("updateChatChannel degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await updateChatChannel("ws1", "01CHAN", { name: "ops" })).toBeNull();
  });

  it("updateChatChannel sends project_id null to clear link", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ room: { ...sampleChannel, project_id: undefined } }));
    await updateChatChannel("ws1", "01CHAN", { project_id: null });
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ project_id: null });
  });

  it("joinChatChannel degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await joinChatChannel("ws1", "01CHAN")).toBeNull();
  });

  it("archiveChatChannel / unarchiveChatChannel degrade on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await archiveChatChannel("ws1", "01CHAN")).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await unarchiveChatChannel("ws1", "01CHAN")).toBe(false);
  });

  it("archiveChatChannel returns true on status ok", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    expect(await archiveChatChannel("ws1", "01CHAN")).toBe(true);
  });

  it("listProjectChatChannels degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listProjectChatChannels("ws1", "01PROJ")).toEqual([]);
  });

  it("listProjectChatChannels returns rooms", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ rooms: [sampleChannel] }));
    const rooms = await listProjectChatChannels("ws1", "01PROJ");
    expect(rooms[0]?.project_id).toBe("01PROJ");
  });
});
