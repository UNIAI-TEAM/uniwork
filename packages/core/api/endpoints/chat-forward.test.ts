import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { forwardChatMessage } from "./chat-forward";
import { ChatMessageSchema } from "./chat-schemas";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("forwardChatMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("posts the targets and returns the copies", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ messages: [{ room_id: "r2", message_id: "m2" }, { room_id: 3 }] }, 201),
    );
    await expect(
      forwardChatMessage("w1", "m1", { target_room_ids: ["r2", "r3"], comment: "xem" }),
    ).resolves.toEqual([{ room_id: "r2", message_id: "m2" }]);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/v1/workspaces/w1/chat/messages/m1/forward");
    expect(JSON.parse(String(init?.body))).toEqual({ target_room_ids: ["r2", "r3"], comment: "xem" });
  });

  it("degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: "nope" }, 201));
    await expect(forwardChatMessage("w1", "m1", { target_room_ids: ["r2"] })).resolves.toEqual([]);
  });

  it("reads a drifted forwarded_from as not forwarded", () => {
    const base = { id: "m", room_id: "r", workspace_id: "w", sender_id: "u", sender_display_name: "U", body: "hi", created_at: "2026-10-18T00:00:00Z" };
    expect(ChatMessageSchema.parse({ ...base, forwarded_from: { sender_id: 5 } }).forwarded_from).toBeUndefined();
    expect(
      ChatMessageSchema.parse({ ...base, forwarded_from: { sender_id: "u2", sender_name: "Hà" } }).forwarded_from,
    ).toEqual({ sender_id: "u2", sender_name: "Hà", sent_at: "" });
  });
});
