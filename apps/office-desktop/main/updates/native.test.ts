import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_IDENTITY_MANIFEST as identity } from "../../shared/identity";
import { createDesktopDraftStore } from "../drafts/store";
import { createFakeDraftKeyStore } from "../drafts/test-fake";
import { DesktopUpdateClient } from "./client";
import { createNativeInstaller, createNativeUpdateAction } from "./native";
import { updateSigningPayload } from "./verifier";

const bytes = Buffer.from("fixture installer bytes, never executed");
const keys = generateKeyPairSync("ed25519");
const trust = { publisher: "Fixture", publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(), engineVersions: [identity.engine.version] };
const unsigned = { url: "https://updates.example.test/setup.exe", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, publisher: trust.publisher, appId: identity.appId, channel: identity.build.channel, engineVersion: identity.engine.version, contractVersion: identity.engine.contractVersion, protocolVersion: identity.engine.protocolVersion, draftFormat: 2 as const };
const release = { ...unsigned, signature: sign(null, updateSigningPayload(unsigned), keys.privateKey).toString("base64") };
const session = { sessionId: "s", deploymentId: "dep", accountId: "a", generation: 1 };
const input = { session, identity: { deploymentId: "dep", accountId: "a", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "r1", version: "v1" } }, draftId: "draft", generation: 1, plaintext: Buffer.from("unsaved local document") };

function fixture(confirm = true, openError = "") {
  const directory = resolve(".test-artifacts", "native-update", crypto.randomUUID());
  const drafts = createDesktopDraftStore({ rootDirectory: directory, keyStore: createFakeDraftKeyStore() });
  const quit = vi.fn(async () => undefined);
  const confirmDrafts = vi.fn(async () => {
    expect(await drafts.list({ session })).toHaveLength(1);
    await expect(drafts.checkpointPlaintext({ ...input, generation: 2 })).rejects.toMatchObject({ code: "storage_unavailable" });
    return confirm;
  });
  const client = new DesktopUpdateClient({
    config: { enabled: true, feed: "https://updates.example.test/feed", publisher: trust.publisher, channel: identity.build.channel }, trust,
    download: async (url) => url.endsWith("/feed") ? Buffer.from(JSON.stringify(release)) : bytes,
    restart: { drafts, confirmDrafts, restart: quit },
  });
  const openPath = vi.fn(async (path: string) => {
    expect(await fs.readFile(path)).toEqual(bytes);
    expect(quit).not.toHaveBeenCalled();
    return openError;
  });
  const report = vi.fn(async (_code: string) => undefined);
  const action = createNativeUpdateAction({ client, report, install: createNativeInstaller({ directory: resolve(directory, "installers"), platform: "win32", openPath }) });
  return { action, drafts, quit, confirmDrafts, report, openPath };
}

describe("native update action with real verifier and draft store", () => {
  it("checkpoints pending drafts, confirms, opens verified installer, then quits once", async () => {
    const f = fixture();
    f.drafts.scheduleCheckpoint(input, true);
    await Promise.all([f.action(), f.action()]);
    expect(f.confirmDrafts).toHaveBeenCalledOnce();
    expect(f.openPath).toHaveBeenCalledOnce();
    expect(f.quit).toHaveBeenCalledOnce();
    expect(f.report).not.toHaveBeenCalled();
  });
  it("does not open installer or quit after checkpoint IO failure", async () => {
    const f = fixture();
    f.drafts.failNextCheckpoint();
    f.drafts.scheduleCheckpoint(input, true);
    await f.action();
    expect(f.report).toHaveBeenCalledWith("checkpoint_failed");
    expect(f.confirmDrafts).not.toHaveBeenCalled();
    expect(f.openPath).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
  });
  it.each([[false, ""], [true, "OS refused installer"]])("reopens draft writes after cancellation or failed install (%s, %s)", async (confirm, error) => {
    const f = fixture(confirm, error);
    f.drafts.scheduleCheckpoint(input, true);
    await f.action();
    expect(f.quit).not.toHaveBeenCalled();
    await expect(f.drafts.checkpointPlaintext({ ...input, generation: 2 })).resolves.toMatchObject({ generation: 2 });
    if (error) expect(f.report).toHaveBeenCalledWith("download_failed");
    else { expect(f.report).not.toHaveBeenCalled(); expect(f.openPath).not.toHaveBeenCalled(); }
  });
  it("exposes the packaged unsigned refusal without network or installer access", async () => {
    const download = vi.fn();
    const install = vi.fn();
    const report = vi.fn();
    await createNativeUpdateAction({ client: new DesktopUpdateClient({ download }), install, report })();
    expect(report).toHaveBeenCalledWith("auto_update_disabled");
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });
  it("refuses an unsupported installer before opening it", async () => {
    const openPath = vi.fn();
    await expect(createNativeInstaller({ directory: resolve(".test-artifacts"), platform: "linux", openPath })(release, bytes)).rejects.toMatchObject({ code: "download_failed" });
    expect(openPath).not.toHaveBeenCalled();
  });
  it("refuses changed installer bytes after writing them", async () => {
    const openPath = vi.fn();
    await expect(createNativeInstaller({ directory: resolve(".test-artifacts", "native-tamper"), platform: "win32", openPath })(release, Buffer.from("tampered"))).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(openPath).not.toHaveBeenCalled();
  });
});
