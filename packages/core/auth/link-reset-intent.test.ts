import { beforeEach, describe, expect, it } from "vitest";
import { defaultStorage } from "../platform/storage";
import { forgetLinkReset, linkResetIntent, linkResetServes, rememberLinkReset } from "./link-reset-intent";

const NOW = Date.parse("2026-10-28T10:00:00Z");

beforeEach(() => forgetLinkReset());

describe("the link-mode reset intent", () => {
  it("remembers who asked, for the pending sign-in's fifteen minutes", () => {
    rememberLinkReset(" An@Company.vn ", NOW);
    expect(linkResetIntent(NOW + 14 * 60_000)).toEqual({ email: "an@company.vn" });
    expect(linkResetIntent(NOW + 15 * 60_000)).toBeNull();
  });

  it("serves only the account it was asked for", () => {
    rememberLinkReset("an@company.vn", NOW);
    const intent = linkResetIntent(NOW);
    expect(linkResetServes(intent, "AN@company.vn")).toBe(true);
    expect(linkResetServes(intent, "binh@company.vn")).toBe(false);
    expect(linkResetServes(intent, undefined)).toBe(false);
    expect(linkResetServes(null, "an@company.vn")).toBe(false);
  });

  it("reads nothing it did not write, and forgets", () => {
    defaultStorage.setItem("uniwork:link-reset", "{not json");
    expect(linkResetIntent(NOW)).toBeNull();
    defaultStorage.setItem("uniwork:link-reset", JSON.stringify({ email: 42, until: NOW + 1 }));
    expect(linkResetIntent(NOW)).toBeNull();
    defaultStorage.setItem("uniwork:link-reset", "null");
    expect(linkResetIntent(NOW)).toBeNull();
    rememberLinkReset("an@company.vn", NOW);
    forgetLinkReset();
    expect(linkResetIntent(NOW)).toBeNull();
  });
});
