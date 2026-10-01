import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it, vi } from "vitest";
import { createProtectedFileCheckpoints } from "./protected-files";

const metadata = { handle: `file_${"x".repeat(40)}`, name: "Local.docx", byteLength: 19, modifiedAtMs: 1, checksum: `sha256:${"a".repeat(64)}` };
const scope = () => ({ accountId: "account", deploymentId: "lane", generation: 1 });
it("encrypts local snapshots and wraps the draft key using the OS storage port", async () => {
  const parent = resolve(process.cwd(), "../../.uniwork-dev-run/local-draft-tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "case-"));
  const encryptString = vi.fn((value: string) => Buffer.from(`os-protected:${value}`));
  const checkpoint = createProtectedFileCheckpoints(root, { isEncryptionAvailable: () => true, encryptString, decryptString: (value) => Buffer.from(value).toString().slice(13) }, scope);
  await checkpoint(metadata, new TextEncoder().encode("private draft text"));
  expect(encryptString).toHaveBeenCalledOnce();
  const namespaces = await fs.readdir(join(root, "local-drafts"));
  const files = await fs.readdir(join(root, "local-drafts", namespaces[0]!));
  const snapshot = await fs.readFile(join(root, "local-drafts", namespaces[0]!, files[0]!), "utf8");
  expect(snapshot).not.toContain("private draft text");
  expect(JSON.parse(snapshot)).toMatchObject({ encrypted: true, generation: 1 });
});

it("refuses a local snapshot if OS key protection is locked", async () => {
  const checkpoint = createProtectedFileCheckpoints(resolve(process.cwd(), "../../.uniwork-dev-run/locked-local-test"), { isEncryptionAvailable: () => false, encryptString: () => new Uint8Array(), decryptString: () => "" }, scope);
  await expect(checkpoint(metadata, new Uint8Array([1, 2]))).rejects.toMatchObject({ code: "draft_recovery_locked" });
});
