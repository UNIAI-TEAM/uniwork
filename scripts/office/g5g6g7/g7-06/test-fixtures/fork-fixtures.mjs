// Fork-side fixture builders for the G7-06 job tests (protocol, extractor).
// Each takes a directory the test already owns (made with tmpDir), so nothing
// here decides lifecycle:
//   mkFakeFork      a git repo with the three protocol files and an extractor
//   writePins       the six *.pin.json of a fake re-pin
//   writeInstalled  an installed bundle root (<root>/<version>/manifest.json)
//   stubExtractor   an extractor that prints given lines (or fails)
//   findRealFork    a fork checkout on this machine holding a pin SHA
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OFFICE_MODULES, sha256Hex } from "../../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import { REPO_ROOT } from "../job-lib.mjs";

/** git with a throwaway identity, so the fake fork commits on any machine. */
export function git(args, cwd) {
  const run = spawnSync("git", ["-c", "user.name=G7-06 test", "-c", "user.email=g7-06@example.invalid", ...args], { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${run.stderr}`);
  return run.stdout.trim();
}

/**
 * A fake fork: git init, the three protocol files, the extractor the caller
 * hands in, one commit. Returns the dir, its HEAD sha and the raw digests.
 */
export function mkFakeFork(dir, { types = "export const types = 1\n", endpoint = "export const endpoint = 1\n", host = "export const host = 1\n", extractor = null } = {}) {
  git(["init", "-q"], dir);
  const protocolDir = join(dir, "web", "docs", "protocol");
  mkdirSync(protocolDir, { recursive: true });
  writeFileSync(join(protocolDir, "types.ts"), types);
  writeFileSync(join(protocolDir, "endpoint.ts"), endpoint);
  writeFileSync(join(protocolDir, "host.ts"), host);
  if (extractor !== null) {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "genoffice-tools-extract.mjs"), extractor);
  }
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "fake fork"], dir);
  return { dir, sha: git(["rev-parse", "HEAD"], dir), digests: digestsOf(dir) };
}

/** The recomputed raw digests of a fake fork's working tree. */
export function digestsOf(dir) {
  return {
    protocol: sha256Hex(readFileSync(join(dir, "web", "docs", "protocol", "types.ts"))),
    endpoint: sha256Hex(readFileSync(join(dir, "web", "docs", "protocol", "endpoint.ts"))),
    host: sha256Hex(readFileSync(join(dir, "web", "docs", "protocol", "host.ts"))),
  };
}

/** Change one protocol file and commit it: the mutation behind a new fork sha. */
export function commitProtocol(dir, key, content) {
  writeFileSync(join(dir, "web", "docs", "protocol", { protocol: "types.ts", endpoint: "endpoint.ts", host: "host.ts" }[key]), content);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", `change ${key}`], dir);
  return git(["rev-parse", "HEAD"], dir);
}

/** The six pins of a fake re-pin; `perModule` overrides one module's record. */
export function writePins(dir, { gitSha, version = "0.1.0-fake", protocolSha256 = null, perModule = {} } = {}) {
  for (const module of OFFICE_MODULES) {
    const pin = {
      schema: 1,
      version,
      gitSha,
      entry: "index.html",
      manifestSha256: "1".repeat(64),
      headers: { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'" },
    };
    const record = Object.hasOwn(perModule, module) ? perModule[module] : protocolSha256;
    if (record) pin.protocolSha256 = record;
    writeFileSync(join(dir, `${module}.pin.json`), `${JSON.stringify(pin, null, 2)}\n`);
  }
  return dir;
}

/** A copy of the real six pins, so a planted edit never touches the checkout. */
export function copyPins(dir) {
  for (const file of readdirSync(join(REPO_ROOT, "apps", "web", "platform", "office-frame")).filter((name) => name.endsWith(".pin.json"))) {
    copyFileSync(join(REPO_ROOT, "apps", "web", "platform", "office-frame", file), join(dir, file));
  }
  return dir;
}

/** An installed bundle root: <dir>/<version>/manifest.json, the docs module. */
export function writeInstalled(dir, { version, gitSha, protocolSha256 = null, dirty = false } = {}) {
  const bundle = join(dir, version);
  mkdirSync(bundle, { recursive: true });
  writeFileSync(
    join(bundle, "manifest.json"),
    `${JSON.stringify(
      {
        module: "docs",
        version,
        gitSha,
        entry: "index.html",
        dirty,
        files: [{ path: "index.html", bytes: 1, sha256: "2".repeat(64) }],
        ...(protocolSha256 ? { protocolSha256 } : {}),
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}


/** The lines the doc's own `sed` pair prints: the block without its markers. */
export function committedExtractBlock() {
  const lines = readFileSync(join(REPO_ROOT, "docs", "office", "g5g6g7", "genoffice-tools.md"), "utf8").split(/\r?\n/);
  const begin = lines.indexOf("<!-- extract:begin -->");
  const end = lines.indexOf("<!-- extract:end -->");
  return lines.slice(begin + 1, end);
}

/** A stub extractor that prints exactly these lines on stdout. */
export function stubExtractor(lines) {
  return `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${lines.join("\n")}\n`)});\n`;
}

/** A stub extractor that fails, the way a broken script does. */
export function failingExtractor(message = "boom: no such rev") {
  return `#!/usr/bin/env node\nprocess.stderr.write(${JSON.stringify(`${message}\n`)});\nprocess.exit(1);\n`;
}

/** The first fork checkout on this machine that holds the pin SHA's protocol files. */
export function findRealFork(sha, cacheRoot = join(homedir(), ".cache", "uniwork-office-harness")) {
  const candidates = [process.env.G706_FORK_DIR, process.env.OFFICE_FORK_DIR, join(cacheRoot, `uniwork-office-${sha}`), join(homedir(), "projects", "uniwork-office")].filter(Boolean);
  for (const dir of candidates) {
    const run = spawnSync("git", ["-C", dir, "cat-file", "-e", `${sha}:web/docs/protocol/host.ts`], { encoding: "utf8" });
    if (run.status === 0) return dir;
  }
  return null;
}