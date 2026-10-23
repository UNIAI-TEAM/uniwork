import { describe, expect, it } from "vitest";
import {
  applySelfAvatarToNameContext,
  buildMemberAvatarUrlMap,
  lookupMemberAvatarUrl,
  memberAvatarUrl,
  resolveAvatarUrlFromNameContext,
  withSelfAvatarFromUser,
} from "./chat-member-avatar";

describe("chat-member-avatar", () => {
  it("reads avatar_url from workspace members", () => {
    const map = buildMemberAvatarUrlMap([
      { user_id: "01JABCDEF", avatar_url: "https://cdn/a.png" },
    ]);
    expect(lookupMemberAvatarUrl(map, "01jabcdef")).toBe("https://cdn/a.png");
  });

  it("overlays the signed-in user from session", () => {
    const map = withSelfAvatarFromUser({}, "u1", "https://cdn/me.png");
    expect(map.U1).toBe("https://cdn/me.png");
  });

  it("resolves avatar from name context", () => {
    const url = resolveAvatarUrlFromNameContext([{ user_id: "u1", avatar_url: "https://cdn/lan.png" }], "U1");
    expect(url).toBe("https://cdn/lan.png");
  });

  it("patches self in name context", () => {
    const next = applySelfAvatarToNameContext<{ user_id: string; avatar_url?: string }>(
      [{ user_id: "u1" }],
      "u1",
      "https://cdn/new.png",
    );
    expect(next[0]?.avatar_url).toBe("https://cdn/new.png");
  });

  it("ignores non-string avatar_url", () => {
    expect(memberAvatarUrl(null)).toBeUndefined();
    expect(memberAvatarUrl("  ")).toBeUndefined();
  });
});
