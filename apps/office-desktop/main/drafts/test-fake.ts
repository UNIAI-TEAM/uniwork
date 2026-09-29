import type { DraftKeyStore } from "./store";
import { randomBytes } from "node:crypto";

export function createFakeDraftKeyStore(): DraftKeyStore {
  const keys = new Map<string, Uint8Array>();
  return {
    async getOrCreate(namespace) {
      const existing = keys.get(namespace);
      if (existing) return existing.slice();
      const key = new Uint8Array(randomBytes(32));
      keys.set(namespace, key);
      return key.slice();
    },
    async delete(namespace) { keys.delete(namespace); },
  };
}
