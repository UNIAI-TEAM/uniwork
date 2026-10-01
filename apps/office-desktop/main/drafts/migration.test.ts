import { describe, expect, it } from "vitest";
import { migrateDraftEnvelope, readDraftEnvelope } from "./migration";

const old = { version: 1, draftId: "draft-1", keyNamespace: "uniwork-office", ciphertext: "ciphertext", checksum: "sha256:test" };
describe("draft migration and rollback", () => {
  it("reads old and new formats without changing ciphertext or key namespace", () => {
    const next = migrateDraftEnvelope(old, 2);
    expect(next).toMatchObject({ version: 2, ciphertext: old.ciphertext, keyNamespace: old.keyNamespace });
    expect(migrateDraftEnvelope(next, 1)).toMatchObject({ version: 1, ciphertext: old.ciphertext, keyNamespace: old.keyNamespace });
  });
  it("refuses malformed envelopes instead of dropping ciphertext", () => expect(() => readDraftEnvelope({ ...old, ciphertext: "" })).toThrow());
});
