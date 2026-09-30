import { describe, expect, it, vi } from "vitest";
import {
  buildOfficeDeepLink,
  launchOfficeDeepLink,
  officeClientId,
  safeOfficeDeepLink,
} from "./desktop-handoff";

const ticket = `ticket_${"x".repeat(32)}`;

describe("desktop handoff browser binding", () => {
  it("builds channel-specific opaque links only", () => {
    expect(buildOfficeDeepLink(ticket, "dev")).toBe(`uniwork-office-dev://open?ticket=${ticket}`);
    expect(buildOfficeDeepLink(ticket, "stable")).toBe(`uniwork-office://open?ticket=${ticket}`);
    expect(officeClientId("dev")).toBe("uniwork-office-dev");
    expect(() => buildOfficeDeepLink("ticket_short", "dev")).toThrow();
    expect(() => buildOfficeDeepLink(`${ticket}&title=secret`, "dev")).toThrow();
  });

  it("does not trust a drifted server URL", () => {
    expect(safeOfficeDeepLink({ launch_ticket: ticket, launch_url: "https://evil.test/?title=x" }, "dev")).toBe(`uniwork-office-dev://open?ticket=${ticket}`);
  });

  it("offers a not-installed outcome when visibility never changes", async () => {
    const open = vi.fn();
    await expect(launchOfficeDeepLink("uniwork-office-dev://open?ticket=x", { open, wait: async () => undefined, isHidden: () => false })).resolves.toBe("not-installed");
    expect(open).toHaveBeenCalledWith("uniwork-office-dev://open?ticket=x");
  });

  it("recognises a handoff when the browser becomes hidden", async () => {
    await expect(launchOfficeDeepLink("uniwork-office://open?ticket=x", { open: vi.fn(), wait: async () => undefined, isHidden: () => true })).resolves.toBe("launched");
  });
});
