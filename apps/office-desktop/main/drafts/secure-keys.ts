import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DraftKeyStore } from "./store";

interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

/** Independent of login tokens. A corrupt or locked key is never replaced. */
export function createSecureDraftKeyStore(root: string, storage: SafeStorage): DraftKeyStore {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    getOrCreate(namespace) {
      const result = tail.then(async () => {
        if (!storage.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === "basic_text") throw new Error("draft key store is locked");
        await fs.mkdir(root, { recursive: true });
        const file = join(root, `${createHash("sha256").update(namespace).digest("hex")}.key`);
        const read = async () => {
          const value = storage.decryptString(await fs.readFile(file));
          if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("draft key is corrupt");
          return Buffer.from(value, "hex");
        };
        try { return await read(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const key = randomBytes(32);
        const encrypted = storage.encryptString(key.toString("hex"));
        // Exclusive creation preserves any key from another process. A torn
        // write remains a refused key, never permission to generate a new one.
        let handle;
        try { handle = await fs.open(file, "wx", 0o600); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return read(); throw error; }
        try { await handle.writeFile(encrypted); await handle.sync(); }
        finally { await handle.close(); }
        return key;
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
