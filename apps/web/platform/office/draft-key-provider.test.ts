import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDraftKeyUnwrapPort } from "@uniwork/core/office/draft-key-port";
import { createDraftKeyProvider } from "./draft-key-provider";

const identity = {
  deploymentId: "deployment-test",
  accountId: "account-a",
  organizationId: "org-a",
  workspaceId: "workspace-a",
  documentId: "document-a",
  base: { revision: "r-1", version: "v-1" },
};
const session = { sessionId: "session-a", deploymentId: "deployment-test", accountId: "account-a", generation: 1 };

async function wrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

afterEach(() => vi.restoreAllMocks());

describe("browser draft key provider", () => {
  it("encrypts with a random per-draft key and recovers through the unwrap port", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const first = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new TextEncoder().encode("secret") });
    const second = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new TextEncoder().encode("secret") });
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    port.setResponse({ status: "unwrapped", wrappedKey: first.wrappedKey });
    const recovered = await provider.decrypt({ session, identity, draftId: "draft-a", generation: 1, checksum: first.checksum, ciphertext: first.ciphertext, wrappedKey: first.wrappedKey, liveAccess: "edit" });
    expect([...recovered]).toEqual([...new TextEncoder().encode("secret")]);
    expect(port.requests[0]).toMatchObject({ draftId: "draft-a", generation: 1 });
  });

  it("fails closed for ACL, conflict, malformed responses, and AAD mismatch", async () => {
    const port = createFakeDraftKeyUnwrapPort({ status: "blocked", reason: "edit_acl_missing" });
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const encrypted = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1, 2, 3]) });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toEqual({ status: "blocked", reason: "edit_acl_missing" });
    port.setResponse({ status: "conflict", currentBase: { revision: "r-2", version: "v-2" }, draftBase: identity.base });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toMatchObject({ status: "conflict" });
    port.setResponse({ status: "unexpected" });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toEqual({ status: "locked", code: "draft_recovery_locked" });
    port.setResponse({ status: "unwrapped", wrappedKey: encrypted.wrappedKey });
    await expect(provider.recover({ session, identity: { ...identity, base: { revision: "r-other", version: "v-1" } }, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toEqual({ status: "locked", code: "draft_recovery_locked" });
  });

  it("requires live edit access and clears registered memory callbacks", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const encrypted = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1]) });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "none" })).resolves.toEqual({ status: "blocked", reason: "edit_acl_missing" });
    const cleanup = vi.fn();
    provider.registerCleanup(cleanup);
    await provider.clearMemory();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("maps WebCrypto encryption failures to a typed storage error", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const generateKey = vi.spyOn(crypto.subtle, "generateKey").mockRejectedValueOnce(new Error("crypto unavailable"));
    await expect(provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1]) })).rejects.toMatchObject({ code: "storage_unavailable" });
    generateKey.mockRestore();
  });

  it("rejects a session without a live generation", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const encrypted = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1]) });
    await expect(provider.recover({ session: { ...session, generation: 0 }, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).rejects.toThrow("invalid draft session");
  });
});
