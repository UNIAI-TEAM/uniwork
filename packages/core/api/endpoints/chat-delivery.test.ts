import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ackChatDelivered } from "./chat-delivery";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ackChatDelivered", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("posts every room of the batch in one request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const rooms = [
      { room_id: "r1", up_to: "2026-10-18T10:00:00.000Z" },
      { room_id: "r2", up_to: "2026-10-18T10:00:00.000Z" },
    ];
    await expect(ackChatDelivered("ws 1", rooms)).resolves.toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws%201/chat/delivered");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ rooms });
  });

  it("degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: 42 }));
    await expect(ackChatDelivered("ws1", [{ room_id: "r1", up_to: "x" }])).resolves.toBe(false);
  });
});
