import { afterEach, describe, expect, it, vi } from "vitest";
import * as chat from "../api/endpoints/chat";
import {
  lookupChatUserByIdCached,
  lookupChatUserCached,
  peekCachedChatUserById,
  resetChatUserLookupCacheForTests,
} from "./user-lookup";

vi.mock("../api/endpoints/chat", () => ({
  lookupChatUser: vi.fn(),
  lookupChatUserById: vi.fn(),
}));

const sample = {
  user_id: "01ABC",
  email: "a@b.com",
  display_name: "Alice",
  matrix_user_id: "@01abc:localhost",
  matrix_ready: true,
};

describe("user-lookup cache", () => {
  afterEach(() => {
    resetChatUserLookupCacheForTests();
    vi.clearAllMocks();
  });

  it("dedupes concurrent lookupChatUserById calls", async () => {
    vi.mocked(chat.lookupChatUserById).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(sample), 20)),
    );

    const [a, b] = await Promise.all([
      lookupChatUserByIdCached("01abc"),
      lookupChatUserByIdCached("01ABC"),
    ]);

    expect(a).toEqual(sample);
    expect(b).toEqual(sample);
    expect(chat.lookupChatUserById).toHaveBeenCalledTimes(1);
    expect(peekCachedChatUserById("01abc")).toEqual(sample);
  });

  it("returns cached result without a second network call", async () => {
    vi.mocked(chat.lookupChatUserById).mockResolvedValue(sample);

    await lookupChatUserByIdCached("01ABC");
    await lookupChatUserByIdCached("01ABC");

    expect(chat.lookupChatUserById).toHaveBeenCalledTimes(1);
  });

  it("lookupChatUserCached shares cache with user id lookups", async () => {
    vi.mocked(chat.lookupChatUser).mockResolvedValue(sample);

    const byEmail = await lookupChatUserCached("a@b.com");
    const byId = peekCachedChatUserById("01ABC");

    expect(byEmail).toEqual(sample);
    expect(byId).toEqual(sample);
    expect(chat.lookupChatUser).toHaveBeenCalledTimes(1);
  });
});
