import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { DesktopDraftStore } from "../drafts/store";
import type { SafeStorageAdapter } from "../auth/credentials";
import type { OpenFileMetadata } from "./registry";

/** Adapt the accepted encrypted draft store without changing G4-04 internals. */
export function createProtectedFileCheckpoints(root: string, safeStorage: SafeStorageAdapter, scope: () => { accountId: string; deploymentId: string; generation: number }) {
  const pendingKeys = new Map<string, Promise<Uint8Array>>();
  const store = new DesktopDraftStore({ rootDirectory: join(root, "local-drafts"), keyStore: {
    getOrCreate(namespace) {
      if (!safeStorage.isEncryptionAvailable()) return Promise.reject(new Error("draft_recovery_locked"));
      const existing = pendingKeys.get(namespace);
      if (existing) return existing;
      const operation = (async () => {
        const directory = join(root, "local-draft-keys");
        await fs.mkdir(directory, { recursive: true });
        const path = join(directory, `${createHash("sha256").update(namespace).digest("hex")}.key`);
        try { return new Uint8Array(Buffer.from(safeStorage.decryptString(await fs.readFile(path)), "base64")); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("draft_recovery_locked");
          const key = randomBytes(32);
          await fs.writeFile(path, safeStorage.encryptString(key.toString("base64")), { flag: "wx", mode: 0o600 });
          return new Uint8Array(key);
        }
      })();
      pendingKeys.set(namespace, operation);
      void operation.finally(() => pendingKeys.delete(namespace)).catch(() => undefined);
      return operation;
    },
  } });
  const generations = new Map<string, number>();
  return async (metadata: OpenFileMetadata, bytes: Uint8Array) => {
    const current = scope();
    const generation = (generations.get(metadata.handle) ?? 0) + 1;
    generations.set(metadata.handle, generation);
    await store.checkpointPlaintext({
      session: { ...current, sessionId: `local-${current.generation}` },
      identity: { accountId: current.accountId, deploymentId: current.deploymentId, organizationId: "local", workspaceId: "local", documentId: metadata.handle, base: { version: metadata.checksum, revision: String(metadata.modifiedAtMs) } },
      draftId: metadata.handle, generation, plaintext: bytes,
    });
  };
}
