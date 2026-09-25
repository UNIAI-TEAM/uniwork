import { describe, expect, it } from "vitest";
import { normalizeEmailHubAddress } from "./email-hub-sender-avatar-context";

describe("normalizeEmailHubAddress", () => {
  it("lowercases a plain address", () => {
    expect(normalizeEmailHubAddress("  User@Example.COM ")).toBe("user@example.com");
  });

  it("extracts the address from a display-name wrapper", () => {
    expect(normalizeEmailHubAddress("Trần Minh <minh@example.com>")).toBe("minh@example.com");
  });
});
