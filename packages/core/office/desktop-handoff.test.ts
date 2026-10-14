import { describe, expect, it } from "vitest";
import {
  buildOfficeDeepLink,
  buildOfficeHomeLink,
  launchCommentId,
  officeClientId,
  officeScheme,
  safeOfficeDeepLink,
} from "./desktop-handoff";

const ticket = `ticket_${"x".repeat(32)}`;
const profile = { deploymentId: "uniwork-prod", apiOrigin: "https://api.uniwork.test/" };

describe("officeScheme / officeClientId", () => {
  it("maps the dev channel to the dev scheme and every other channel to the shared one", () => {
    expect(officeScheme("dev")).toBe("uniwork-office-dev");
    expect(officeScheme("beta")).toBe("uniwork-office");
    expect(officeScheme("stable")).toBe("uniwork-office");
    expect(officeClientId("dev")).toBe("uniwork-office-dev");
    expect(officeClientId("beta")).toBe("uniwork-office");
  });
});

describe("buildOfficeDeepLink", () => {
  it("builds an opaque, channel-specific link from the ticket alone", () => {
    expect(buildOfficeDeepLink(ticket, "dev")).toBe(`uniwork-office-dev://open?ticket=${ticket}`);
    expect(buildOfficeDeepLink(ticket)).toBe(`uniwork-office://open?ticket=${ticket}`);
  });

  it("refuses a ticket that is short, long or carries extra parameters", () => {
    expect(() => buildOfficeDeepLink("ticket_short", "dev")).toThrow(TypeError);
    expect(() => buildOfficeDeepLink(`${ticket}&title=secret`, "dev")).toThrow("invalid office launch ticket");
    expect(() => buildOfficeDeepLink(`ticket_${"y".repeat(186)}`, "stable")).toThrow(TypeError);
  });

  it("appends the deployment profile as four URL-encoded parameters", () => {
    expect(buildOfficeDeepLink(ticket, "stable", profile)).toBe(
      `uniwork-office://open?ticket=${ticket}&deploymentId=uniwork-prod&apiOrigin=https%3A%2F%2Fapi.uniwork.test&clientId=uniwork-office&channel=stable`,
    );
  });

  it("allows loopback HTTP origins on the dev channel only", () => {
    const loopback = { deploymentId: "dev", apiOrigin: "http://localhost:8080" };
    expect(buildOfficeDeepLink(ticket, "dev", loopback)).toContain("&apiOrigin=http%3A%2F%2Flocalhost%3A8080&clientId=uniwork-office-dev&channel=dev");
    expect(buildOfficeDeepLink(ticket, "stable", loopback)).toBe(`uniwork-office://open?ticket=${ticket}`);
    expect(buildOfficeDeepLink(ticket, "dev", { deploymentId: "dev", apiOrigin: "http://api.uniwork.test" })).toBe(`uniwork-office-dev://open?ticket=${ticket}`);
  });

  it.each([
    ["a path", { deploymentId: "dep", apiOrigin: "https://api.uniwork.test/v1" }],
    ["credentials", { deploymentId: "dep", apiOrigin: "https://u:p@api.uniwork.test" }],
    ["a query", { deploymentId: "dep", apiOrigin: "https://api.uniwork.test/?a=1" }],
    ["a fragment", { deploymentId: "dep", apiOrigin: "https://api.uniwork.test/#x" }],
    ["a backslash", { deploymentId: "dep", apiOrigin: "https://api.uniwork.test\\@evil.test" }],
    ["an unparsable origin", { deploymentId: "dep", apiOrigin: "not a url" }],
    ["a deployment id that starts with a dash", { deploymentId: "-bad", apiOrigin: "https://api.uniwork.test" }],
    ["an over-long deployment id", { deploymentId: `a${"b".repeat(128)}`, apiOrigin: "https://api.uniwork.test" }],
  ])("leaves the whole profile off when it has %s", (_name, bad) => {
    expect(buildOfficeDeepLink(ticket, "stable", bad)).toBe(`uniwork-office://open?ticket=${ticket}`);
  });
});

describe("launchCommentId", () => {
  it("passes an id-shaped ?comment= to the launch ticket and leaves anything else off", () => {
    expect(launchCommentId("01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(launchCommentId("c_1-a")).toBe("c_1-a");
    for (const raw of [null, undefined, "", "a b", "c1&x=1", "x".repeat(129), "../c1"]) {
      expect(launchCommentId(raw)).toBeUndefined();
    }
  });
});

describe("safeOfficeDeepLink", () => {
  it("rebuilds the link from the ticket and ignores a server-sent URL", () => {
    expect(safeOfficeDeepLink({ launch_ticket: ticket, launch_url: "https://evil.test/?title=x" }, "dev")).toBe(`uniwork-office-dev://open?ticket=${ticket}`);
    expect(safeOfficeDeepLink({ launch_ticket: ticket }, "stable", profile)).toBe(buildOfficeDeepLink(ticket, "stable", profile));
  });

  it("throws when the session ticket is malformed", () => {
    expect(() => safeOfficeDeepLink({ launch_ticket: "nope" }, "stable")).toThrow(TypeError);
  });
});

describe("buildOfficeHomeLink", () => {
  it("opens the home route with no ticket and no query when there is no profile", () => {
    expect(buildOfficeHomeLink()).toBe("uniwork-office://home");
    expect(buildOfficeHomeLink("dev")).toBe("uniwork-office-dev://home");
  });

  it("carries the public deployment profile and nothing else", () => {
    expect(buildOfficeHomeLink("beta", profile)).toBe(
      "uniwork-office://home?deploymentId=uniwork-prod&apiOrigin=https%3A%2F%2Fapi.uniwork.test&clientId=uniwork-office&channel=beta",
    );
  });

  it("drops a profile the app would refuse", () => {
    expect(buildOfficeHomeLink("stable", { deploymentId: "dep", apiOrigin: "http://localhost:8080" })).toBe("uniwork-office://home");
  });
});
