import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { listChatRoomLinkPreviews } from "./chat-link-previews";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat link preview endpoint", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ previews: [{ message_id: 1 }] }));
    await expect(listChatRoomLinkPreviews("w1", "r1", ["m1", "m2"])).resolves.toEqual([]);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      "/chat/rooms/r1/link-previews?message_ids=m1%2Cm2",
    );
  });

  it("keeps a card whose optional fields drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ previews: [{ message_id: "m1", url: "https://uniwork.vn", title: 7, image_url: null }] }),
    );
    const [card] = await listChatRoomLinkPreviews("w1", "r1", ["m1"]);
    expect(card).toMatchObject({ message_id: "m1", url: "https://uniwork.vn", title: "", image_url: undefined });
  });

  it("skips the request when there is nothing to ask", async () => {
    await expect(listChatRoomLinkPreviews("w1", "r1", [])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
