import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildPin } from "./frame-bundle.mjs";
import { checkInstalled, install, loadBundle, locateBundleDir, materialize } from "./frame-install.mjs";
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
