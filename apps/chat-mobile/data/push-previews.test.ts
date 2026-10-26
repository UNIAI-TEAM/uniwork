import { beforeEach, describe, expect, it, vi } from "vitest";

const accountApi = vi.hoisted(() => ({ setPushPreviews: vi.fn() }));
vi.mock("./account-api", () => ({ accountApi }));
const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, setUser: vi.fn((user: Record<string, unknown>) => (auth.user = user)) }));
vi.mock("./auth/store", () => ({ useAuthStore: { getState: () => auth } }));

import { setPushPreviews } from "./push-previews";

const user = { id: "u1", email: "a@b.c", display_name: "A" };

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { ...user };
});

describe("setPushPreviews", () => {
  it("records the choice and adopts the server's user", async () => {
    accountApi.setPushPreviews.mockResolvedValueOnce({ ...user, push_previews: false, locale: "vi" });
    await setPushPreviews(false);
    expect(accountApi.setPushPreviews).toHaveBeenCalledWith(false);
    expect(auth.user).toMatchObject({ push_previews: false, locale: "vi" });
  });

  it("a drifted answer still updates the user it was recorded for, and nobody signed in changes nothing", async () => {
    accountApi.setPushPreviews.mockResolvedValueOnce(null);
    await setPushPreviews(false);
    expect(auth.user).toMatchObject({ push_previews: false });
    auth.user = null;
    accountApi.setPushPreviews.mockResolvedValueOnce(null);
    await setPushPreviews(true);
    expect(auth.setUser).toHaveBeenCalledTimes(1);
  });

  it("a refusal reaches the caller and changes nothing", async () => {
    accountApi.setPushPreviews.mockRejectedValueOnce(new Error("offline"));
    await expect(setPushPreviews(false)).rejects.toThrow("offline");
    expect(auth.setUser).not.toHaveBeenCalled();
  });
});
