#!/usr/bin/env node
// UniChat desktop release helpers (UNI-1835) for .github/workflows/chat-desktop-release.yml.
//
//   node apps/chat-desktop/scripts/release.mjs meta chat-desktop-v0.1.0-dev.1
//       prints `version=0.1.0-dev.1` and `channel=dev` for $GITHUB_OUTPUT
//   node apps/chat-desktop/scripts/release.mjs feed <release download URL> <file.yml>…
//       rewrites electron-builder's update files in place so their files point at
//       that release; the copies on the rolling chat-desktop-feed release then
//       lead every installed app to the versioned release's assets.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const NUMBER = "(?:0|[1-9][0-9]*)";
const TAG = new RegExp(`^chat-desktop-v(${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(dev|beta)\\.${NUMBER})?)$`);
// electron-builder writes `- url: <file>` (each entry of `files`) and the legacy `path: <file>`.
const FEED_FILE_LINE = /^(\s*- url: |path: )(.*)$/gm;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `chat-desktop-v1.2.3[-dev.N|-beta.N]` → the app version and its release channel. */
export function releaseFromTag(tag) {
  const match = TAG.exec(tag);
  if (!match) throw new Error(`tag must be chat-desktop-v<major.minor.patch>[-dev.N|-beta.N], got: ${tag}`);
  return { version: match[1], channel: match[2] ?? "stable" };
}

/** An update file whose file entries are absolute URLs under `baseUrl`. */
export function absoluteFeed(yml, baseUrl) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.search || base.hash) throw new Error("feed base URL must be https without query or fragment");
  const root = base.href.replace(/\/+$/, "");
  return yml.replace(FEED_FILE_LINE, (_line, key, file) => {
    if (!SAFE_FILE_NAME.test(file)) throw new Error(`unexpected file name in update feed: ${file}`);
    return `${key}${root}/${file}`;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "meta" && args.length === 1) {
      const { version, channel } = releaseFromTag(args[0]);
      process.stdout.write(`version=${version}\nchannel=${channel}\n`);
    } else if (command === "feed" && args.length >= 2) {
      const [baseUrl, ...files] = args;
      for (const file of files) writeFileSync(file, absoluteFeed(readFileSync(file, "utf8"), baseUrl));
    } else {
      throw new Error("usage: release.mjs meta <tag> | feed <https base URL> <file.yml>…");
    }
  } catch (error) {
    process.stderr.write(`release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
