import { describe, expect, it, vi } from "vitest";
import { decideNavigation, installNavigationGuards, isAllowedExternalUrl } from "./navigation";

describe("desktop navigation policy", () => {
  it("allows only internal app schemes", () => {
    expect(decideNavigation("uniwork-office-app://app/index.html").action).toBe("allow");
    expect(decideNavigation("uniwork-office-preview://doc/1").action).toBe("deny");
    expect(decideNavigation("uniwork-office-asset://asset/1").action).toBe("deny");
    expect(decideNavigation("file:///etc/passwd").action).toBe("deny");
  });
  it("requires https and an explicit host allowlist for external URLs", () => {
    expect(isAllowedExternalUrl("https://docs.uniwork.com/help", ["docs.uniwork.com"])).toBe(true);
    expect(isAllowedExternalUrl("http://docs.uniwork.com/help", ["docs.uniwork.com"])).toBe(false);
    expect(isAllowedExternalUrl("https://evil.example", ["docs.uniwork.com"])).toBe(false);
  });
  it("blocks navigation and window.open while forwarding approved external URLs", () => {
    const prevented: boolean[] = [];
    const external = vi.fn();
    const listeners: Record<string, (event: { preventDefault(): void }, url: string) => void> = {};
    const contents = { on: vi.fn((event, listener) => { listeners[event] = listener; }), setWindowOpenHandler: vi.fn() };
    installNavigationGuards(contents, ["docs.uniwork.com"], external);
    listeners["will-navigate"]!({ preventDefault: () => prevented.push(true) }, "uniwork-office-app://app/index.html");
    expect(prevented).toEqual([]);
    listeners["will-navigate"]!({ preventDefault: () => prevented.push(true) }, "https://docs.uniwork.com/help");
    expect(prevented).toEqual([true]);
    expect(external).toHaveBeenCalledWith("https://docs.uniwork.com/help");
    listeners["will-redirect"]!({ preventDefault: () => prevented.push(true) }, "file:///etc/passwd");
    listeners["will-frame-navigate"]!({ preventDefault: () => prevented.push(true) }, "https://evil.example");
    expect(prevented).toHaveLength(3);
    const handler = contents.setWindowOpenHandler.mock.calls[0]![0]!;
    expect(handler({ url: "https://evil.example" })).toEqual({ action: "deny" });
    expect(external).toHaveBeenCalledTimes(1);
  });
});
