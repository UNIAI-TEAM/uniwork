import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@uniwork/core/platform";
import { chatOnlyPolicy, parseDeepLink, resolveChatOnlyPath } from "./chat-only-navigation";

describe("resolveChatOnlyPath", () => {
  it.each([
    ["/login", "/login"],
    ["/login?next=/x", "/login?next=/x"],
    ["/auth/desktop/authorize?x", "/auth/desktop/authorize?x"],
    ["/invite/abc", "/invite/abc"],
    ["/workspaces", "/workspaces"],
    // /admin is a global prefix, so the shell keeps it.
    ["/admin", "/admin"],
    ["/acme/team/chat", "/acme/team/chat"],
    ["/acme/team/chat/", "/acme/team/chat/"],
    ["/acme/team/chat?room=r1&message=m1", "/acme/team/chat?room=r1&message=m1"],
    ["/acme/team", "/acme/team/chat"],
    ["/acme/team/tasks", "/acme/team/chat"],
    ["/acme/team/tasks?view=board", "/acme/team/chat"],
    ["/acme/team/tasks/01HZZZZZZZZZZZZZZZZZZZZZZZ", null],
    ["/acme/team/documents/x", null],
    ["/acme/team/chatter", null],
  ])("%s → %s", (path, expected) => {
    expect(resolveChatOnlyPath(path)).toBe(expected);
  });
});

describe("parseDeepLink", () => {
  const appUrl = "https://app.test";
  it.each([
    ["uniworkchat://open?url=/acme/team/chat?room=r1", "/acme/team/chat?room=r1"],
    ["uniworkchat://open?url=//evil", null],
    ["uniworkchat://open", null],
    ["uniworkchat://other?url=/x", null],
    ["https://app.test/acme/team/chat?room=r1", "/acme/team/chat?room=r1"],
    ["https://evil.example/acme/team/chat", null],
    ["https://app.test:8443/acme/team/chat", null],
    ["http://app.test/acme/team/chat", null],
    ["not a url", null],
  ])("%s → %s", (url, expected) => {
    expect(parseDeepLink(url, appUrl)).toBe(expected);
  });
});

describe("chatOnlyPolicy", () => {
  it("resolves in-shell paths and hands the rest to the bridge", () => {
    const openExternal = vi.fn(() => Promise.resolve());
    const policy = chatOnlyPolicy({ openExternal } as unknown as DesktopBridge);
    expect(policy.resolve("/acme/team/tasks")).toBe("/acme/team/chat");
    policy.openExternal("https://app.test/acme/team/documents/x");
    expect(openExternal).toHaveBeenCalledWith("https://app.test/acme/team/documents/x");
  });
});
