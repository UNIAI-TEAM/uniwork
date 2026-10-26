import { describe, expect, it } from "vitest";
import { isAppleRelayAddress } from "./apple-relay";

describe("isAppleRelayAddress", () => {
  it("knows Hide My Email's forwarding address, whatever its case or spacing", () => {
    expect(isAppleRelayAddress("q7x@privaterelay.appleid.com")).toBe(true);
    expect(isAppleRelayAddress(" Q7x@PrivateRelay.AppleID.com ")).toBe(true);
  });

  it("is not fooled by an address that only mentions the relay", () => {
    expect(isAppleRelayAddress("an@example.com")).toBe(false);
    expect(isAppleRelayAddress("privaterelay.appleid.com@example.com")).toBe(false);
    expect(isAppleRelayAddress("an@mail.privaterelay.appleid.com")).toBe(false);
    expect(isAppleRelayAddress("@privaterelay.appleid.com")).toBe(false);
    expect(isAppleRelayAddress("")).toBe(false);
  });
});
