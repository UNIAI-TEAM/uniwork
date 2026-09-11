import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookupChatUserByIdCached,
  lookupChatUserCached,
  peekCachedChatUserByEmail,
  peekCachedChatUserById,
  resetChatUserLookupCacheForTests,
} from "./user-lookup";
import * as chat from "../api/endpoints/chat";

vi.mock("../api/endpoints/chat", () => ({
  lookupChatUser: vi.fn(),
  lookupChatUserById: vi.fn(),
}));

const sample = {
  user_id: "01ABC",
  email: "a@b.com",
  display_name: "Alice",
};

const WS = "01WORKSPACE";

describe("user-lookup", () => {
  beforeEach(() => {
    resetChatUserLookupCacheForTests();
    vi.clearAllMocks();
  });

  it("dedupes concurrent lookupChatUserById calls", async () => {
    vi.mocked(chat.lookupChatUserById).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(sample), 20)),
    );

    const [a, b] = await Promise.all([
      lookupChatUserByIdCached(WS, "01abc"),
      lookupChatUserByIdCached(WS, "01ABC"),
    ]);

    expect(a).toEqual(sample);
    expect(b).toEqual(sample);
    expect(chat.lookupChatUserById).toHaveBeenCalledTimes(1);
    expect(chat.lookupChatUserById).toHaveBeenCalledWith(WS, "01ABC");
  });

  it("returns cached lookupChatUserById without a second request", async () => {
    vi.mocked(chat.lookupChatUserById).mockResolvedValue(sample);

    await lookupChatUserByIdCached(WS, "01ABC");
    await lookupChatUserByIdCached(WS, "01ABC");

    expect(chat.lookupChatUserById).toHaveBeenCalledTimes(1);
  });

  it("peekCachedChatUserById returns the cached lookup and null on miss", async () => {
    expect(peekCachedChatUserById(WS, "01ABC")).toBeNull();

    vi.mocked(chat.lookupChatUserById).mockResolvedValue(sample);
    await lookupChatUserByIdCached(WS, "01abc");

    expect(peekCachedChatUserById(WS, "01ABC")).toEqual(sample);
    expect(peekCachedChatUserById("OTHER_WS", "01ABC")).toBeNull();
  });

  it("peekCachedChatUserByEmail returns the cached lookup and null on miss", async () => {
    expect(peekCachedChatUserByEmail(WS, "a@b.com")).toBeNull();

    vi.mocked(chat.lookupChatUser).mockResolvedValue(sample);
    await lookupChatUserCached(WS, "A@B.COM");

    expect(peekCachedChatUserByEmail(WS, "a@b.com")).toEqual(sample);
    expect(peekCachedChatUserByEmail("OTHER_WS", "a@b.com")).toBeNull();
  });

  it("lookupChatUserCached shares cache with user id lookups per workspace", async () => {
    vi.mocked(chat.lookupChatUser).mockResolvedValue(sample);

    const byEmail = await lookupChatUserCached(WS, "a@b.com");
    const byId = await lookupChatUserByIdCached(WS, "01ABC");

    expect(byEmail).toEqual(sample);
    expect(byId).toEqual(sample);
    expect(chat.lookupChatUser).toHaveBeenCalledTimes(1);
    expect(chat.lookupChatUserById).not.toHaveBeenCalled();
  });
});
