// Decline (POST …/voice/decline): what it sends, what it reads from a good answer, and that a malformed answer
// degrades to false instead of throwing (CLAUDE.md › API Compatibility).
import { describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async () => ({ status: "ok" })) }));
vi.mock("../api", () => ({ api: transport }));

const { callSignals, createCallSignals } = await import("./call-signals");

describe("call signals", () => {
  it("declines with the call's id on the room's voice route", async () => {
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async () => ({ status: "ok" }));
    expect(await createCallSignals(request).decline("w1", "r 1", "c1")).toBe(true);
    expect(request).toHaveBeenCalledWith("/api/v1/workspaces/w1/chat/rooms/r%201/voice/decline", { method: "POST", body: JSON.stringify({ call_id: "c1" }) });
  });

  it("reads a malformed answer as not taken", async () => {
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async () => "nope");
    expect(await createCallSignals(request).decline("w1", "r1", "c1")).toBe(false);
  });

  it("goes over the app's transport", async () => {
    expect(await callSignals.decline("w1", "r1", "c1")).toBe(true);
    expect(transport.request).toHaveBeenCalledWith("/api/v1/workspaces/w1/chat/rooms/r1/voice/decline", expect.objectContaining({ method: "POST" }));
  });
});
