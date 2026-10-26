import { afterEach, describe, expect, it } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { expiresAtFromDays, inviteLinkUrl } from "./invite-link-url";

afterEach(resetRuntimeConfig);

describe("inviteLinkUrl", () => {
  it("puts the secret in the fragment of the app's invite route", () => {
    configureRuntime({ appUrl: "https://app.uniwork.test" });
    expect(inviteLinkUrl("01LINK", "s3cr3t")).toBe("https://app.uniwork.test/invite/meeting/01LINK#secret=s3cr3t");
  });
});

describe("expiresAtFromDays", () => {
  it("adds whole days to the given clock", () => {
    const now = Date.parse("2026-10-24T00:00:00.000Z");
    expect(expiresAtFromDays(7, now)).toBe("2026-10-31T00:00:00.000Z");
    expect(expiresAtFromDays(0, now)).toBe("2026-10-24T00:00:00.000Z");
  });
});
