import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  convertChatFollowUpToTask,
  createChatFollowUp,
  deleteChatFollowUp,
  listChatFollowUps,
  patchChatFollowUp,
} from "./chat-follow-ups";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat follow-up endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("listChatFollowUps degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ follow_ups: "nope" }));
    await expect(listChatFollowUps("w1")).resolves.toEqual([]);
  });

  it("listChatFollowUps keeps message and room context fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        follow_ups: [
          {
            id: "f1",
            message_id: "m1",
            room_id: "r1",
            room_kind: "dm",
            peer_display_name: "Binh",
            message_body: "hello later",
            message_kind: "text",
            message_sender_name: "Long",
          },
        ],
      }),
    );
    const rows = await listChatFollowUps("w1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.peer_display_name).toBe("Binh");
    expect(rows[0]?.message_body).toBe("hello later");
    expect(rows[0]?.message_sender_name).toBe("Long");
    expect(rows[0]?.room_kind).toBe("dm");
  });

  it("createChatFollowUp degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ follow_up: 1 }));
    await expect(createChatFollowUp("w1", "m1", { note: "hi" })).resolves.toBeNull();
  });

  it("patchChatFollowUp degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ follow_up: null }));
    await expect(patchChatFollowUp("w1", "f1", { completed: true })).resolves.toBeNull();
  });

  it("deleteChatFollowUp degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({}));
    await expect(deleteChatFollowUp("w1", "f1")).resolves.toBe(false);
  });

  it("convertChatFollowUpToTask degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: "x" }));
    await expect(convertChatFollowUpToTask("w1", "f1")).resolves.toBeNull();
  });
});
