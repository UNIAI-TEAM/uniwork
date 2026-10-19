import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("../api", () => ({ api: apiMock }));

import { devicesOptions, fetchDevices, revokeDevice } from "./devices";

const now = Date.parse("2026-10-17T12:00:00Z");
const device = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: "uniwork-chat-mobile",
  device_label: `Phone ${id}`,
  platform: "ios",
  last_used_at: "2026-10-17T11:00:00Z",
  expires_at: "2026-11-17T11:00:00Z",
  revoked_at: null,
  current: false,
  ...extra,
});

beforeEach(() => apiMock.request.mockReset());

describe("fetchDevices", () => {
  it("lists live devices with this one first, leaving out revoked, expired and unreadable rows", async () => {
    apiMock.request.mockResolvedValueOnce({
      devices: [
        device("d1"),
        device("d2", { revoked_at: "2026-10-16T00:00:00Z" }),
        device("d3", { expires_at: "2026-10-01T00:00:00Z" }),
        { device_label: "no id" },
        device("d4", { current: true }),
        device("d5", { expires_at: undefined }),
      ],
      next_cursor: null,
    });
    const signal = new AbortController().signal;
    const list = await fetchDevices(signal, now);
    expect(list.map((d) => d.id)).toEqual(["d4", "d1", "d5"]);
    expect(apiMock.request).toHaveBeenCalledWith("/api/v1/auth/desktop/devices", { signal });
  });

  it("reads a malformed body as no devices", async () => {
    apiMock.request.mockResolvedValueOnce({ devices: "x" });
    expect(await fetchDevices(undefined, now)).toEqual([]);
  });
});

describe("revokeDevice", () => {
  it("deletes the named device session", async () => {
    apiMock.request.mockResolvedValueOnce({ status: "ok" });
    await revokeDevice("01J/x");
    expect(apiMock.request).toHaveBeenCalledWith("/api/v1/auth/desktop/devices/01J%2Fx", { method: "DELETE" });
  });
});

describe("devicesOptions", () => {
  it("has one account-wide key", async () => {
    const options = devicesOptions();
    expect(options.queryKey).toEqual(["auth-devices"]);
    apiMock.request.mockResolvedValueOnce({ devices: [] });
    await (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({ signal: new AbortController().signal });
    expect(apiMock.request).toHaveBeenCalledTimes(1);
  });
});
