import { beforeEach, describe, expect, it } from "vitest";
import { defaultStorage } from "../platform/storage";
import { forgetLinkReset, linkResetIntent, linkResetServes, rememberLinkReset } from "./link-reset-intent";

const NOW = Date.parse("2026-10-28T10:00:00Z");

beforeEach(() => forgetLinkReset());

describe("the link-mode reset intent", () => {
  it("remembers who asked, for the pending sign-in's fifteen minutes, and never in the clear", async () => {
    await rememberLinkReset(" An@Company.vn ", NOW);
    const stored = defaultStorage.getItem("uniwork:link-reset") ?? "";
    expect(stored).not.toContain("an@company.vn");
    expect(stored.toLowerCase()).not.toContain("company");
    expect(linkResetIntent(NOW + 14 * 60_000)).toEqual({ digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(linkResetIntent(NOW + 15 * 60_000)).toBeNull();
  });

  it("serves only the account it was asked for", async () => {
    await rememberLinkReset("an@company.vn", NOW);
    const intent = linkResetIntent(NOW);
    expect(await linkResetServes(intent, "AN@company.vn")).toBe(true);
    expect(await linkResetServes(intent, "binh@company.vn")).toBe(false);
    expect(await linkResetServes(intent, undefined)).toBe(false);
    expect(await linkResetServes(null, "an@company.vn")).toBe(false);
  });

  it("leaves nothing stored once a read finds it expired or unreadable", async () => {
    await rememberLinkReset("an@company.vn", NOW);
    expect(linkResetIntent(NOW + 15 * 60_000)).toBeNull();
    expect(defaultStorage.getItem("uniwork:link-reset")).toBeNull();
    defaultStorage.setItem("uniwork:link-reset", "{not json");
    expect(linkResetIntent(NOW)).toBeNull();
    expect(defaultStorage.getItem("uniwork:link-reset")).toBeNull();
  });

  it("reads nothing it did not write, an older build's address in the clear included, and forgets", async () => {
    defaultStorage.setItem("uniwork:link-reset", JSON.stringify({ email: "an@company.vn", until: NOW + 60_000 }));
    expect(linkResetIntent(NOW)).toBeNull();
    expect(defaultStorage.getItem("uniwork:link-reset")).toBeNull();
    defaultStorage.setItem("uniwork:link-reset", JSON.stringify({ digest: 42, until: NOW + 1 }));
    expect(linkResetIntent(NOW)).toBeNull();
    defaultStorage.setItem("uniwork:link-reset", "null");
    expect(linkResetIntent(NOW)).toBeNull();
    await rememberLinkReset("an@company.vn", NOW);
    forgetLinkReset();
    expect(linkResetIntent(NOW)).toBeNull();
  });
});
