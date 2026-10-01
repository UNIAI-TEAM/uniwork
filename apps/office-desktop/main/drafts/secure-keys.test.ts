import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSecureDraftKeyStore } from "./secure-keys";

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`protected:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^protected:/, ""),
};
const root = () => resolve(".test-artifacts", "secure-keys", crypto.randomUUID());

describe("OS-protected independent draft keys", () => {
  it("persists one key across concurrent calls and process instances, isolates namespaces", async () => {
    const directory = root();
    const store = createSecureDraftKeyStore(directory, storage);
    const [a, b] = await Promise.all([store.getOrCreate("one"), store.getOrCreate("one")]);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
    expect(await createSecureDraftKeyStore(directory, storage).getOrCreate("one")).toEqual(a);
    expect(await store.getOrCreate("two")).not.toEqual(a);
    expect((await fs.readdir(directory)).every((name) => /^[a-f0-9]{64}\.key$/.test(name))).toBe(true);
  });
  it("refuses unavailable or plaintext OS protection", async () => {
    for (const safe of [{ ...storage, isEncryptionAvailable: () => false }, { ...storage, getSelectedStorageBackend: () => "basic_text" }]) {
      const directory = root();
      await expect(createSecureDraftKeyStore(directory, safe).getOrCreate("one")).rejects.toThrow("locked");
      await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it("retains a corrupt key and never substitutes new key material", async () => {
    const directory = root();
    await createSecureDraftKeyStore(directory, storage).getOrCreate("one");
    const file = join(directory, (await fs.readdir(directory))[0]!);
    await fs.writeFile(file, "corrupt");
    await expect(createSecureDraftKeyStore(directory, storage).getOrCreate("one")).rejects.toThrow("corrupt");
    expect(await fs.readFile(file, "utf8")).toBe("corrupt");
  });
});
