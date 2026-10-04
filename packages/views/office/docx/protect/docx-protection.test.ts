// C3 (UNI-924): the protection state reader and comparators. The reader only
// accepts the records the vendored parse produces — an untrusted document must
// not smuggle GUI state through a malformed protection tag.
import { describe, expect, it } from "vitest";
import {
  modifySummary,
  protectionEquals,
  protectionFromParsed,
  protectionStateFromParsed,
  restrictionSummary,
  writeProtectionEquals,
  writeProtectionFromParsed,
} from "./docx-protection";

const CREDENTIALS = { hash: "aGFzaA==", salt: "c2FsdA==", spinCount: 1000, algorithmSid: 14 };

describe("protectionFromParsed", () => {
  it("reads the record the vendored parse produces", () => {
    expect(protectionFromParsed({ edit: "readOnly", enforced: true, ...CREDENTIALS })).toEqual({
      edit: "readOnly",
      enforced: true,
      ...CREDENTIALS,
    });
    expect(protectionFromParsed({ edit: "comments", enforced: false })).toEqual({ edit: "comments", enforced: false });
  });

  it("treats every other shape as no state, never a guessed one", () => {
    expect(protectionFromParsed(null)).toBeNull();
    expect(protectionFromParsed("readOnly")).toBeNull();
    expect(protectionFromParsed({})).toBeNull();
    expect(protectionFromParsed({ edit: "", enforced: true })).toBeNull();
    expect(protectionFromParsed({ edit: "readOnly" })).toBeNull();
    expect(protectionFromParsed({ edit: "readOnly", enforced: "1" })).toBeNull();
    expect(protectionFromParsed({ edit: "readOnly", enforced: true, hash: "" })).toEqual({ edit: "readOnly", enforced: true });
    expect(protectionFromParsed({ edit: "readOnly", enforced: true, spinCount: 1.5 })).toEqual({ edit: "readOnly", enforced: true });
  });
});

describe("writeProtectionFromParsed", () => {
  it("reads the recommended and password forms", () => {
    expect(writeProtectionFromParsed({ recommended: true })).toEqual({ recommended: true });
    expect(writeProtectionFromParsed({ hash: CREDENTIALS.hash, salt: CREDENTIALS.salt, spinCount: 1000, algorithmSid: 14 })).toEqual({
      hash: CREDENTIALS.hash,
      salt: CREDENTIALS.salt,
      spinCount: 1000,
      algorithmSid: 14,
    });
    expect(writeProtectionFromParsed({ recommended: true, ...CREDENTIALS })).toEqual({ recommended: true, ...CREDENTIALS });
  });

  it("drops records with nothing to enforce and malformed flags", () => {
    expect(writeProtectionFromParsed(null)).toBeNull();
    expect(writeProtectionFromParsed({})).toBeNull();
    expect(writeProtectionFromParsed({ recommended: false })).toBeNull();
    expect(writeProtectionFromParsed({ recommended: "1" })).toBeNull();
  });
});

describe("protectionStateFromParsed", () => {
  it("reads both tags off an open parse", () => {
    expect(
      protectionStateFromParsed({ protection: { edit: "forms", enforced: true }, writeProtection: { recommended: true } }),
    ).toEqual({ protection: { edit: "forms", enforced: true }, writeProtection: { recommended: true } });
    expect(protectionStateFromParsed({})).toEqual({ protection: null, writeProtection: null });
    expect(protectionStateFromParsed(undefined)).toEqual({ protection: null, writeProtection: null });
  });
});

describe("protection comparators", () => {
  it("compares the save-relevant fields only", () => {
    const base = { edit: "readOnly", enforced: true, ...CREDENTIALS };
    expect(protectionEquals(base, { ...base })).toBe(true);
    expect(protectionEquals(null, null)).toBe(true);
    expect(protectionEquals(null, base)).toBe(false);
    expect(protectionEquals(base, { ...base, enforced: false })).toBe(false);
    expect(protectionEquals(base, { ...base, hash: "b3RoZXI=" })).toBe(false);
    const write = { recommended: true, ...CREDENTIALS };
    expect(writeProtectionEquals(write, { ...write })).toBe(true);
    expect(writeProtectionEquals(write, { ...write, recommended: undefined })).toBe(false);
    expect(writeProtectionEquals(null, null)).toBe(true);
  });
});

describe("panel summaries", () => {
  it("summarises a restriction, flagging unknown modes", () => {
    expect(restrictionSummary(null)).toBeNull();
    expect(restrictionSummary({ edit: "readOnly", enforced: true, ...CREDENTIALS })).toEqual({
      mode: "readOnly",
      known: true,
      enforced: true,
      passwordProtected: true,
    });
    expect(restrictionSummary({ edit: "oddball", enforced: false })).toEqual({
      mode: "oddball",
      known: false,
      enforced: false,
      passwordProtected: false,
    });
  });

  it("summarises a password-to-modify", () => {
    expect(modifySummary(null)).toBeNull();
    expect(modifySummary({ recommended: true })).toEqual({ recommended: true, passwordProtected: false });
    expect(modifySummary({ hash: CREDENTIALS.hash })).toEqual({ recommended: false, passwordProtected: true });
  });
});
