import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "./frame-bundle.mjs";

const CSP = "default-src 'self'; script-src 'self'; frame-ancestors 'self'";

export interface FixtureOptions {
  /** The manifest's module; absent like a docs build from before modules. */
  module?: string;
  version?: string;
  gitSha?: string;
  files?: Record<string, string>;
  csp?: unknown;
  dirty?: boolean;
}

/** Writes a fork-shaped build (files + manifest.json + csp.json) and returns its directory. */
export function writeBundle(options: FixtureOptions = {}): string {
  const version = options.version ?? "0.1.0-abc1234";
  const files = options.files ?? { "index.html": "<!doctype html><title>docs</title>", "assets/app-1a2b.js": "export {}", "assets/fonts/a.woff2": "font" };
  const dir = mkdtempSync(join(tmpdir(), "frame-fixture-"));
  const rows = Object.entries(files).map(([path, text]) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
    return { path, bytes: Buffer.byteLength(text), sha256: sha256Hex(text) };
  });
  const manifest = { ...(options.module ? { module: options.module } : {}), version, gitSha: options.gitSha ?? "abc1234def5678", builtAt: "2026-10-08T00:00:00Z", entry: "index.html", dirty: options.dirty, files: rows };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, "csp.json"), JSON.stringify(options.csp ?? { "Content-Security-Policy": CSP }));
  return dir;
}
