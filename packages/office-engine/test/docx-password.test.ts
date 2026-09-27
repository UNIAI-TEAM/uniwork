// P5 — DOCX password intent: set/clear/revision state, decrypt→edit→save→
// reopen-still-encrypted, typed policy refusal when no re-encryption path is
// bound, and the zero-secret-in-clear guarantee.
import { describe, expect, it } from "vitest";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createDocxAdapter, DocPasswordIntents, isEncryptedOoxml } from "../src/docx";
import {
  createFakeDocxCrypto,
  createFakeDocxEngine,
  decodeFakeDocx,
  fakeEncryptDocx,
  makeFakeDocxBytes,
} from "./fake-docx-engine";

const PW = "s3cret-열쇠";

const plain = () =>
  makeFakeDocxBytes({ blocks: [{ type: "paragraph", runs: [{ text: "secret body" }] }] });

describe("DocPasswordIntents", () => {
  it("set/clear intents issue monotonic revisions; snapshot prefers intent over disk", () => {
    const intents = new DocPasswordIntents();
    intents.rememberDiskPassword("doc-1", PW);
    expect(intents.snapshot("doc-1")).toMatchObject({ password: PW, source: "disk" });
    const r1 = intents.setIntent("doc-1", "new-pw");
    const r2 = intents.setIntent("doc-1", null);
    expect(r2).toBeGreaterThan(r1);
    expect(intents.intentRevision()).toBe(r2);
    expect(intents.snapshot("doc-1")).toMatchObject({ password: null, source: "intent", intentRevision: r2 });
  });

  it("commitSave moves effective password into disk state and drains intents", () => {
    const intents = new DocPasswordIntents();
    intents.rememberDiskPassword("doc-1", PW);
    const r = intents.setIntent("doc-1", null);
    const snap = intents.snapshot("doc-1");
    intents.commitSave("doc-1", snap);
    expect(intents.diskPassword("doc-1")).toBeNull();
    expect(intents.snapshot("doc-1")).toMatchObject({ password: null, source: "none" });
    expect(intents.intentRevisionOf("doc-1")).toBe(0);
    expect(r).toBeGreaterThan(0);
  });

  it("discardThrough drops consumed intents only", () => {
    const intents = new DocPasswordIntents();
    const r1 = intents.setIntent("a", "x");
    const r2 = intents.setIntent("b", "y");
    intents.discardThrough(r1);
    expect(intents.intentRevisionOf("a")).toBe(0);
    expect(intents.intentRevisionOf("b")).toBe(r2);
  });
});

describe("P5 decrypt → edit → save → reopen", () => {
  const encryptedFixture = () => fakeEncryptDocx(plain(), PW);

  it("reopened output is still encrypted with the SAME password", async () => {
    const adapter = createDocxAdapter({
      engine: createFakeDocxEngine(),
      crypto: createFakeDocxCrypto(),
    });
    const opened = await adapter.open({ bytes: encryptedFixture(), format: "docx", document_id: "doc-p5", password: PW });
    if (opened.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(opened));
    const ref = opened.document_model_ref;
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 0, runs: [{ text: "edited secret" }] });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    // the saved bytes are the fake encrypted container again
    expect(isEncryptedOoxml(saved.bytes)).toBe(true);
    // and the same password opens them — the wrong one does not
    const crypto = createFakeDocxCrypto();
    await expect(crypto.decrypt(saved.bytes, "nope")).rejects.toThrowError(/password is incorrect/);
    const back = await crypto.decrypt(saved.bytes, PW);
    const pkg = decodeFakeDocx(back) as { blocks: Array<{ runs?: Array<{ text: string }> }> };
    expect(pkg.blocks.some((b) => (b.runs ?? []).some((r) => r.text === "edited secret"))).toBe(true);
    // password never appears in any returned surface
    const surface = JSON.stringify(saved);
    expect(surface).not.toContain(PW);
    expect(surface).not.toContain("password");
  });

  it("encrypted source + no encryptor bound => typed policy refusal, never plaintext", async () => {
    const adapter = createDocxAdapter({
      engine: createFakeDocxEngine(),
      crypto: {
        // decrypt-only seam: open works, save must refuse by policy
        decrypt: createFakeDocxCrypto().decrypt,
      },
    });
    const opened = await adapter.open({ bytes: encryptedFixture(), format: "docx", document_id: "doc-ref", password: PW });
    if (opened.outcome !== "opened") throw new Error("open failed");
    const ref = opened.document_model_ref;
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 0, runs: [{ text: "x" }] });
    const error = await adapter
      .serialize({ document_model_ref: ref, format: "docx" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostCapabilityRefusal);
    expect((error as HostCapabilityRefusal).reason).toBe("policy");
    expect(JSON.stringify(error)).not.toContain(PW);
  });

  it("cleared intent (password → null) makes a plaintext save legal", async () => {
    const adapter = createDocxAdapter({
      engine: createFakeDocxEngine(),
      crypto: createFakeDocxCrypto(),
    });
    const opened = await adapter.open({ bytes: encryptedFixture(), format: "docx", document_id: "doc-clr", password: PW });
    if (opened.outcome !== "opened") throw new Error("open failed");
    const ref = opened.document_model_ref;
    const rev = adapter.setPasswordIntent("doc-clr", null);
    expect(rev).toBeGreaterThan(0);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(isEncryptedOoxml(saved.bytes)).toBe(false); // user asked to drop the password
    // the new base is now unencrypted — next save needs no seam
    const s2 = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(isEncryptedOoxml(s2.bytes)).toBe(false);
  });

  it("new intent password re-encrypts with the new one, not the disk password", async () => {
    const NEW_PW = "newer-key";
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine(), crypto: createFakeDocxCrypto() });
    const enc = fakeEncryptDocx(plain(), PW);
    const opened = await adapter.open({ bytes: enc, format: "docx", document_id: "doc-rot", password: PW });
    if (opened.outcome !== "opened") throw new Error("open failed");
    const rev = adapter.setPasswordIntent("doc-rot", NEW_PW);
    expect(adapter.passwordIntentRevision("doc-rot")).toBe(rev);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "docx" });
    expect(isEncryptedOoxml(saved.bytes)).toBe(true);
    // the container is sealed with the NEW password: it opens with NEW_PW,
    // the old disk password no longer verifies.
    const crypto = createFakeDocxCrypto();
    await expect(crypto.decrypt(saved.bytes, PW)).rejects.toThrowError(/password is incorrect/);
    const re = await crypto.decrypt(saved.bytes, NEW_PW);
    expect(re.length).toBeGreaterThan(0);
  });

  it("intent revision is monotonic and carries to the adapter API", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine(), crypto: createFakeDocxCrypto() });
    const r1 = adapter.setPasswordIntent("doc-a", "p1");
    const r2 = adapter.setPasswordIntent("doc-b", "p2");
    const r3 = adapter.setPasswordIntent("doc-a", null);
    expect(r2).toBeGreaterThan(r1);
    expect(r3).toBeGreaterThan(r2);
    expect(adapter.passwordIntentRevision()).toBe(r3);
    expect(adapter.passwordIntentRevision("doc-a")).toBe(r3);
    expect(adapter.passwordIntentRevision("doc-b")).toBe(r2);
  });
});
