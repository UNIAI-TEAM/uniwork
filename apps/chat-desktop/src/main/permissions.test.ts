import { describe, expect, it } from "vitest";
import { decidePermission, PERMISSIONS_ALLOWED } from "./permissions";

const APP = "https://app.uniworkos.com";

describe("decidePermission", () => {
  it("grants an allowlisted permission to the app main frame", () => {
    for (const permission of PERMISSIONS_ALLOWED) {
      expect(decidePermission(permission, `${APP}/acme/chat`, true, APP)).toBe(true);
    }
    expect(PERMISSIONS_ALLOWED).toEqual(
      new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write", "fullscreen"]),
    );
  });

  it("refuses a permission outside the allowlist", () => {
    expect(decidePermission("geolocation", `${APP}/`, true, APP)).toBe(false);
    expect(decidePermission("openExternal", `${APP}/`, true, APP)).toBe(false);
  });

  it("refuses a sub-frame and a foreign, file or unparseable requester", () => {
    expect(decidePermission("media", `${APP}/`, false, APP)).toBe(false);
    expect(decidePermission("media", "https://evil.example/", true, APP)).toBe(false);
    expect(decidePermission("media", "file:///offline.html", true, APP)).toBe(false);
    expect(decidePermission("media", "", true, APP)).toBe(false);
  });
});
