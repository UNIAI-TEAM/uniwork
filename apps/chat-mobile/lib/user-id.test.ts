import { describe, expect, it } from "vitest";
import { sameUser, userKey } from "./user-id";

describe("userKey / sameUser", () => {
  it("keys an id case-insensitively, without stray spaces", () => {
    expect(userKey(" 01jbx4user ")).toBe("01JBX4USER");
    expect(sameUser("01jbx4user", " 01JBX4USER")).toBe(true);
    expect(sameUser("01JBX4USER", "01JBX4OTHER")).toBe(false);
  });
});
