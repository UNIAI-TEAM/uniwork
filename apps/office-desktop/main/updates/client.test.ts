import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { createServer, type Server } from "node:https";
import { resolve, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DESKTOP_IDENTITY_MANIFEST as identity } from "../../shared/identity";
import { DesktopUpdateClient, downloadUpdateBytes } from "./client";
import { updateSigningPayload, type UpdateRelease } from "./verifier";

const bytes = Buffer.from("local fixture installer");
const keys = generateKeyPairSync("ed25519");
const trust = { publisher: "Fixture", publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(), engineVersions: [identity.engine.version] };
let server: Server;
let origin: string;
let certificate: string;
let descriptor: UpdateRelease;
let deliveredBytes = bytes;
let requests: string[] = [];

beforeAll(async () => {
  const directory = resolve(".test-artifacts", "update-tls", crypto.randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const openssl = process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe") ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
  certificate = await fs.readFile(join(directory, "cert.pem"), "utf8");
  server = createServer({ key: await fs.readFile(join(directory, "key.pem")), cert: certificate }, (request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/redirect") { response.writeHead(302, { Location: "http://127.0.0.1/unsafe" }); response.end(); return; }
    response.end(request.url === "/feed" ? JSON.stringify(descriptor) : deliveredBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server has no TCP address");
  origin = `https://127.0.0.1:${address.port}`;
  const release = { url: `${origin}/installer`, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, publisher: trust.publisher, appId: identity.appId, channel: identity.build.channel, engineVersion: identity.engine.version, contractVersion: identity.engine.contractVersion, protocolVersion: identity.engine.protocolVersion, draftFormat: 1 as const };
  descriptor = { ...release, signature: sign(null, updateSigningPayload(release), keys.privateKey).toString("base64") };
}, 20_000);
afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

function client(restart = vi.fn(async () => undefined), flushScheduled = vi.fn(async () => undefined)) {
  return new DesktopUpdateClient({
    config: { enabled: true, feed: `${origin}/feed`, publisher: trust.publisher, channel: identity.build.channel }, trust,
    download: (url, limit) => downloadUpdateBytes(url, limit, certificate),
    restart: { drafts: { flushScheduled, migrateFormat: async () => undefined }, confirmDrafts: async () => true, restart },
  });
}

describe("local HTTPS update feed", () => {
  it("downloads, verifies and checkpoints before installer and restart", async () => {
    const order: string[] = [];
    const instance = client(vi.fn(async () => { order.push("restart"); }), vi.fn(async () => { order.push("checkpoint"); }));
    requests = [];
    const result = await instance.checkAndDownload();
    result.sha256 = "0".repeat(64);
    await instance.restartToInstall(async (_release, downloaded) => { order.push("install"); expect(Buffer.from(downloaded)).toEqual(bytes); });
    expect(order).toEqual(["checkpoint", "install", "restart"]);
    expect(requests).toEqual(["/feed", "/installer"]);
  });
  it("refuses a real untrusted TLS certificate without disabling verification", async () => {
    await expect(downloadUpdateBytes(`${origin}/feed`, 65536)).rejects.toMatchObject({ code: "tls_failure" });
  });
  it("refuses redirect and oversize responses", async () => {
    await expect(downloadUpdateBytes(`${origin}/redirect`, 65536, certificate)).rejects.toMatchObject({ code: "download_failed" });
    await expect(downloadUpdateBytes(`${origin}/installer`, 1, certificate)).rejects.toMatchObject({ code: "download_failed" });
  });
  it("refuses tampered installer bytes and exposes nothing to install", async () => {
    deliveredBytes = Buffer.from("x".repeat(bytes.length));
    const instance = client();
    try { await expect(instance.checkAndDownload()).rejects.toMatchObject({ code: "hash_mismatch" }); }
    finally { deliveredBytes = bytes; }
    const install = vi.fn();
    await expect(instance.restartToInstall(install)).rejects.toMatchObject({ code: "download_failed" });
    expect(install).not.toHaveBeenCalled();
  });
  it("aborts installation and restart on a checkpoint failure", async () => {
    const restart = vi.fn();
    const install = vi.fn();
    const instance = client(restart, vi.fn(async () => { throw new Error("disk full"); }));
    await instance.checkAndDownload();
    await expect(instance.restartToInstall(install)).rejects.toMatchObject({ code: "checkpoint_failed" });
    expect(install).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
  it("default packaged policy refuses before network activity", async () => {
    const download = vi.fn();
    await expect(new DesktopUpdateClient({ download }).checkAndDownload()).rejects.toMatchObject({ code: "auto_update_disabled" });
    expect(download).not.toHaveBeenCalled();
  });
});
