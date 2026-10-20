import { describe, expect, it, vi } from "vitest";
import {
  DEEP_LINK_CHANNEL,
  extractDeepLinkFromArgv,
  MainRendererQueue,
  parseDeepLink,
} from "./deep-link";

const SCHEME = "uniworkchat";

describe("parseDeepLink", () => {
  it("returns the decoded path of <scheme>://open?url=", () => {
    expect(parseDeepLink("uniworkchat://open?url=%2Facme%2Fchat%2F01H", SCHEME)).toBe("/acme/chat/01H");
    expect(parseDeepLink("uniworkchat://open/?url=%2Fx%3Fa%3D1%23b", SCHEME)).toBe("/x?a=1#b");
  });

  it("only accepts the configured scheme and the open host", () => {
    expect(parseDeepLink("uniworkchat-dev://open?url=%2Fx", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open?url=%2Fx", "uniworkchat-dev")).toBeNull();
    expect(parseDeepLink("uniworkchat://auth/callback?code=1&state=2", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://Open?url=%2Fx", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open/more?url=%2Fx", SCHEME)).toBeNull();
    // https deep links are D2 (spec §3.4).
    expect(parseDeepLink("https://app.uniworkos.com/acme/chat", SCHEME)).toBeNull();
  });

  it("rejects a path that is missing, relative, protocol-relative or backslashed", () => {
    expect(parseDeepLink("uniworkchat://open", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open?url=", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open?url=acme%2Fchat", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open?url=https%3A%2F%2Fevil.example", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open?url=%2F%2Fevil.example%2Fx", SCHEME)).toBeNull();
    expect(parseDeepLink("uniworkchat://open?url=%2F%5Cevil.example", SCHEME)).toBeNull();
  });

  it("rejects non-strings and unparseable input", () => {
    expect(parseDeepLink(undefined, SCHEME)).toBeNull();
    expect(parseDeepLink(42, SCHEME)).toBeNull();
    expect(parseDeepLink("not a url", SCHEME)).toBeNull();
  });
});

describe("extractDeepLinkFromArgv", () => {
  it("returns the first deep link path among the arguments", () => {
    const argv = ["/Applications/UniChat.app", "--flag", "uniworkchat://open?url=%2Fa", "uniworkchat://open?url=%2Fb"];
    expect(extractDeepLinkFromArgv(argv, SCHEME)).toBe("/a");
  });

  it("ignores callbacks, foreign schemes and non-strings", () => {
    expect(
      extractDeepLinkFromArgv(["uniworkchat://auth/callback?code=1", "uniworkchat-dev://open?url=%2Fa", 3], SCHEME),
    ).toBeNull();
    expect(extractDeepLinkFromArgv([], SCHEME)).toBeNull();
  });
});

describe("MainRendererQueue", () => {
  it("holds a deep link until the renderer reports the channel ready, then delivers once", () => {
    const queue = new MainRendererQueue();
    const send = vi.fn();

    queue.enqueue(DEEP_LINK_CHANNEL, "/a", send);
    queue.enqueue(DEEP_LINK_CHANNEL, "/b", send);
    expect(send).not.toHaveBeenCalled();

    queue.setReady(DEEP_LINK_CHANNEL, true, send);
    expect(send.mock.calls).toEqual([
      [DEEP_LINK_CHANNEL, "/a"],
      [DEEP_LINK_CHANNEL, "/b"],
    ]);

    queue.setReady(DEEP_LINK_CHANNEL, true, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("delivers immediately while the channel is ready", () => {
    const queue = new MainRendererQueue();
    const send = vi.fn();

    queue.setReady(DEEP_LINK_CHANNEL, true, send);
    queue.enqueue(DEEP_LINK_CHANNEL, "/a", send);
    expect(send).toHaveBeenCalledOnce();
  });

  it("holds again after the renderer unsubscribes or reloads", () => {
    const queue = new MainRendererQueue();
    const send = vi.fn();

    queue.setReady(DEEP_LINK_CHANNEL, true, send);
    queue.setReady(DEEP_LINK_CHANNEL, false, send);
    queue.enqueue(DEEP_LINK_CHANNEL, "/a", send);
    expect(send).not.toHaveBeenCalled();

    queue.setReady(DEEP_LINK_CHANNEL, true, send);
    queue.resetReady();
    queue.enqueue(DEEP_LINK_CHANNEL, "/b", send);
    expect(send).toHaveBeenCalledTimes(1);

    queue.setReady(DEEP_LINK_CHANNEL, true, send);
    expect(send).toHaveBeenLastCalledWith(DEEP_LINK_CHANNEL, "/b");
  });
});
