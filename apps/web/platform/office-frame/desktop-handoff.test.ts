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

  it("carries the public deployment profile, all four values or none", () => {
    const profile = { deploymentId: "uniwork-prod", apiOrigin: "https://api.uniwork.test/" };
    expect(buildOfficeDeepLink(ticket, "stable", profile)).toBe(`uniwork-office://open?ticket=${ticket}&deploymentId=uniwork-prod&apiOrigin=https%3A%2F%2Fapi.uniwork.test&clientId=uniwork-office&channel=stable`);
    expect(buildOfficeDeepLink(ticket, "dev", { deploymentId: "dev", apiOrigin: "http://localhost:8080" })).toContain("&apiOrigin=http%3A%2F%2Flocalhost%3A8080&clientId=uniwork-office-dev&channel=dev");
    // A profile the app would refuse is left off, never sent half-valid.
    for (const bad of [
      { deploymentId: "dep", apiOrigin: "http://localhost:8080" },
      { deploymentId: "dep", apiOrigin: "http://api.uniwork.test" },
      { deploymentId: "dep", apiOrigin: "https://api.uniwork.test/v1" },
      { deploymentId: "dep", apiOrigin: "https://u:p@api.uniwork.test" },
      { deploymentId: "-bad", apiOrigin: "https://api.uniwork.test" },
      { deploymentId: "dep", apiOrigin: "not a url" },
    ]) expect(buildOfficeDeepLink(ticket, "stable", bad)).toBe(`uniwork-office://open?ticket=${ticket}`);
    expect(safeOfficeDeepLink({ launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}` }, "stable", profile)).toBe(buildOfficeDeepLink(ticket, "stable", profile));
  });

  it("does not trust a drifted server URL", () => {
    expect(safeOfficeDeepLink({ launch_ticket: ticket, launch_url: "https://evil.test/?title=x" }, "dev")).toBe(`uniwork-office-dev://open?ticket=${ticket}`);
  });

  it("offers a not-installed outcome when visibility never changes", async () => {
    const open = vi.fn();
    await expect(launchOfficeDeepLink("uniwork-office-dev://open?ticket=x", { open, wait: async () => undefined, isHidden: () => false })).resolves.toBe("not-installed");
    expect(open).toHaveBeenCalledWith("uniwork-office-dev://open?ticket=x");
  });

  it("recognises a handoff when the page loses focus while waiting, even if it stays visible (GOA9-r4-05)", async () => {
    const wait = async () => { window.dispatchEvent(new Event("blur")); };
    await expect(launchOfficeDeepLink("uniwork-office://open?ticket=x", { open: vi.fn(), wait, isHidden: () => false })).resolves.toBe("launched");
  });

  it("stops listening once the wait is over", async () => {
    await launchOfficeDeepLink("uniwork-office://open?ticket=x", { open: vi.fn(), wait: async () => undefined, isHidden: () => false });
    const remove = vi.spyOn(window, "removeEventListener");
    await launchOfficeDeepLink("uniwork-office://open?ticket=x", { open: vi.fn(), wait: async () => undefined, isHidden: () => false });
    expect(remove).toHaveBeenCalledWith("blur", expect.any(Function));
    remove.mockRestore();
  });

  it("recognises a handoff when the browser becomes hidden", async () => {
    await expect(launchOfficeDeepLink("uniwork-office://open?ticket=x", { open: vi.fn(), wait: async () => undefined, isHidden: () => true })).resolves.toBe("launched");
  });
});
