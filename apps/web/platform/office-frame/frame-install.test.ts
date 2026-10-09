import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { buildPin } from "./frame-bundle.mjs";
import { assertSafeArchive, checkInstalled, DEFAULT_ARCHIVE_LIMITS, install, loadBundle, locateBundleDir, materialize, offerableFrameVersion } from "./frame-install.mjs";
import { writeBundle } from "./frame-fixture";

const scratch = () => mkdtempSync(join(tmpdir(), "frame-install-"));

describe("loadBundle", () => {
  it("verifies every file against the manifest and returns the digest of manifest.json", () => {
    const bundle = loadBundle(writeBundle());
    expect(bundle.manifest.files).toHaveLength(3);
    expect(bundle.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.headers["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
  });
  it("refuses a file whose content changed, whose size changed, or that is missing", () => {
    const tampered = writeBundle();
    writeFileSync(join(tampered, "assets/app-1a2b.js"), "export {};evil()");
    expect(() => loadBundle(tampered)).toThrow(/assets\/app-1a2b\.js/);
    const sameSizeTampered = writeBundle();
    writeFileSync(join(sameSizeTampered, "assets/app-1a2b.js"), "export {X");
    expect(() => loadBundle(sameSizeTampered)).toThrow(/sha256/);
    const missing = writeBundle();
    writeFileSync(join(missing, "csp.json"), "{}");
    expect(() => loadBundle(missing)).toThrow(/Content-Security-Policy/);
  });
  it("refuses a build from a dirty fork checkout unless a local run allows it", () => {
    const dir = writeBundle({ dirty: true });
    expect(() => loadBundle(dir)).toThrow(/dirty/);
    expect(loadBundle(dir, { allowDirty: true }).manifest.dirty).toBe(true);
  });
  it("refuses a csp.json that lets another origin frame the editor", () => {
    expect(() => loadBundle(writeBundle({ csp: { policy: "default-src 'self'; frame-ancestors *" } }))).toThrow(/frame-ancestors/);
  });
});

describe("install / checkInstalled", () => {
  it("copies the listed files plus manifest and csp, replaces older versions, and re-verifies", () => {
    const root = join(scratch(), "docs");
    mkdirSync(join(root, "0.0.9-old"), { recursive: true });
    const dir = writeBundle();
    const bundle = loadBundle(dir);
    const target = install(dir, bundle, root);
    expect(readdirSync(root)).toEqual(["0.1.0-abc1234"]);
    expect(existsSync(join(target, "assets/fonts/a.woff2"))).toBe(true);
    expect(existsSync(join(target, "csp.json"))).toBe(true);

    const pin = buildPin(bundle.manifest, bundle.manifestSha256, bundle.headers);
    expect(checkInstalled(pin, root)).toBe(true);
    expect(checkInstalled({ ...pin, version: "9.9.9" }, root)).toBe(false);

    writeFileSync(join(target, "index.html"), "<!doctype html><title>xxxx</title>");
    expect(() => checkInstalled(pin, root)).toThrow(/index\.html/);
  });
  it("re-install is idempotent and does not leave staging directories", () => {
    const root = join(scratch(), "docs");
    const dir = writeBundle();
    const bundle = loadBundle(dir);
    install(dir, bundle, root);
    install(dir, bundle, root);
    expect(readdirSync(root)).toEqual(["0.1.0-abc1234"]);
  });
  it("notices an installed csp.json that no longer matches the pin", () => {
    const root = join(scratch(), "docs");
    const dir = writeBundle();
    const bundle = loadBundle(dir);
    const target = install(dir, bundle, root);
    const pin = buildPin(bundle.manifest, bundle.manifestSha256, { ...bundle.headers, "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'" });
    expect(() => checkInstalled(pin, root)).toThrow(/csp\.json differs/);
    expect(readFileSync(join(target, "manifest.json"), "utf8")).toContain("0.1.0-abc1234");
  });
});

describe("materialize / locateBundleDir", () => {
  it("accepts the version directory itself or its parent holding exactly one version", () => {
    const dir = writeBundle();
    expect(locateBundleDir(dir)).toBe(dir);
    const parent = scratch();
    mkdirSync(join(parent, "v1"));
    expect(() => locateBundleDir(parent)).toThrow(/no manifest\.json/);
  });
  it("unpacks a .tar.gz of the version directory", async () => {
    const dir = writeBundle();
    const archive = join(scratch(), "bundle.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", dir, "."]);
    const out = await materialize(archive, scratch());
    expect(loadBundle(out).manifest.version).toBe("0.1.0-abc1234");
  });
});

describe("offerableFrameVersion", () => {
  it("offers the pinned version only when it is installed and verifies", () => {
    const root = join(scratch(), "docs");
    const dir = writeBundle();
    const bundle = loadBundle(dir);
    const pin = buildPin(bundle.manifest, bundle.manifestSha256, bundle.headers);
    expect(offerableFrameVersion(null, root)).toBe("");
    expect(offerableFrameVersion(pin, root)).toBe("");
    const target = install(dir, bundle, root);
    expect(offerableFrameVersion(pin, root)).toBe(pin.version);
    writeFileSync(join(target, "index.html"), "<!doctype html><title>xxxx</title>");
    expect(offerableFrameVersion(pin, root)).toBe("");
  });
});

describe("archive sources are checked before they are extracted", () => {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, timeoutMs: 20_000 };
  const pack = (setup: (dir: string) => void, args: string[] = []) => {
    const dir = scratch();
    setup(dir);
    const archive = join(scratch(), "x.tar.gz");
    execFileSync("tar", ["-czf", archive, ...args, "-C", dir, "."]);
    return archive;
  };

  it("accepts the build as an archive", async () => {
    const dir = writeBundle();
    const archive = join(scratch(), "ok.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", dir, "."]);
    expect(() => assertSafeArchive(archive, limits)).not.toThrow();
  });
  it("refuses a symlink member", () => {
    const archive = pack((dir) => { writeFileSync(join(dir, "a"), "x"); symlinkSync("/etc/passwd", join(dir, "link")); });
    expect(() => assertSafeArchive(archive, limits)).toThrow(/not a regular file or directory/);
  });
  it("refuses a member that climbs out of the bundle", () => {
    const parent = scratch();
    mkdirSync(join(parent, "inner"));
    writeFileSync(join(parent, "evil.txt"), "x");
    const archive = join(scratch(), "up.tar.gz");
    execFileSync("tar", ["-czPf", archive, "-C", join(parent, "inner"), "../evil.txt"]);
    expect(() => assertSafeArchive(archive, limits)).toThrow(/escapes the bundle/);
  });
  it("refuses an archive over the size, entry or unpacked-size cap", () => {
    const dir = writeBundle();
    const archive = join(scratch(), "big.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", dir, "."]);
    expect(() => assertSafeArchive(archive, { ...limits, maxArchiveBytes: 10 })).toThrow(/larger than/);
    expect(() => assertSafeArchive(archive, { ...limits, maxEntries: 2 })).toThrow(/more than 2 entries/);
    expect(() => assertSafeArchive(archive, { ...limits, maxUnpackedBytes: 5 })).toThrow(/unpacks to more than/);
  });
  it("does not extract a refused archive", async () => {
    const archive = pack((dir) => { writeFileSync(join(dir, "a"), "x"); symlinkSync("/etc/passwd", join(dir, "link")); });
    const out = scratch();
    await expect(materialize(archive, out, limits)).rejects.toThrow(/regular file/);
    expect(existsSync(join(out, "unpacked"))).toBe(false);
  });
  it("gives up on a download that exceeds the cap or never answers", async () => {
    const body = (bytes: number) => new Response(new Uint8Array(bytes));
    vi.stubGlobal("fetch", vi.fn(async () => body(2_000)));
    await expect(materialize("https://files.test/b.tar.gz", scratch(), { ...limits, maxArchiveBytes: 1_000 })).rejects.toThrow(/larger than/);
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    })));
    await expect(materialize("https://files.test/b.tar.gz", scratch(), { ...limits, timeoutMs: 50 })).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
