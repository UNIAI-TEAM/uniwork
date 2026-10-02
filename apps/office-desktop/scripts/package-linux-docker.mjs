#!/usr/bin/env node
// Linux .deb/AppImage build path for a Windows host (spec §4): the container
// runs the same scripts/package.mjs entry, so the artifact contract is the one
// the native Linux build uses. The image is pinned by digest and verified with
// `docker manifest inspect` before use (the MinIO lesson); the checkout is
// copied into the container so a Linux install can never overwrite the host's
// node_modules. Not wired into CI.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appDirectory, "../..");
const defaultOutput = resolve(process.env.OFFICE_DESKTOP_OUTPUT ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "artifacts"));

/** electronuserland/builder:20 (Ubuntu 22.04, Node 20, pnpm, fakeroot, rpm tools). */
export const LINUX_BUILDER_IMAGE = "electronuserland/builder:20@sha256:4771aae3cd4b606e9e79f9adb0b463c361dd1dee80133fe9ce527b5eb241749c";
export const LINUX_BUILDER_DIGEST = "sha256:4771aae3cd4b606e9e79f9adb0b463c361dd1dee80133fe9ce527b5eb241749c";

export function assertPinnedImage(image = LINUX_BUILDER_IMAGE) {
  const match = /^(?<repository>[a-z0-9./-]+):(?<tag>[A-Za-z0-9._-]+)@sha256:(?<digest>[0-9a-f]{64})$/.exec(image);
  if (!match) throw new Error(`Linux builder image must be pinned by tag and sha256 digest: ${image}`);
  return image;
}

/** Windows resolves an extensionless spawn target only through cmd, so name the
 * executable explicitly; `docker.exe` works from a plain spawnSync. */
export function dockerExecutable(platform = process.platform) {
  return platform === "win32" ? "docker.exe" : "docker";
}

export function verifyPinnedImage(image = LINUX_BUILDER_IMAGE) {
  assertPinnedImage(image);
  const result = spawnSync(dockerExecutable(), ["manifest", "inspect", image], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  if (result.status !== 0) throw new Error(`docker manifest inspect failed for the pinned Linux builder image: ${image}`);
  return true;
}

export function dockerRunArguments({ repository = repositoryRoot, output = defaultOutput, image = LINUX_BUILDER_IMAGE, environment = process.env } = {}) {
  assertPinnedImage(image);
  const containerScript = [
    "set -euo pipefail",
    "mkdir -p /build/work",
    "tar -C /src --exclude='*node_modules*' --exclude='.git' --exclude='dist' -cf - . | tar -C /build/work -xf -",
    "cd /build/work",
    "command -v fakeroot >/dev/null || { apt-get update -qq && apt-get install -y -qq --no-install-recommends fakeroot; }",
    "corepack enable >/dev/null 2>&1 || true",
    "pnpm install --frozen-lockfile",
    "node apps/office-desktop/scripts/package.mjs --platform linux --output /out",
  ].join(" && ");
  const environmentArguments = [];
  for (const key of ["UNIWORK_OFFICE_CHANNEL", "UNIWORK_OFFICE_BUILD_NUMBER", "UNIWORK_OFFICE_DEPLOYMENT_ID", "UNIWORK_OFFICE_API_ORIGIN", "OFFICE_DESKTOP_HOMEPAGE", "OFFICE_DESKTOP_MAINTAINER"]) {
    if (environment[key] !== undefined && environment[key] !== "") environmentArguments.push("-e", `${key}=${environment[key]}`);
  }
  environmentArguments.push("-e", "OFFICE_DESKTOP_CACHE=/tmp/office-desktop-cache");
  return [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "-v",
    `${resolve(repository).replaceAll("\\", "/")}:/src:ro`,
    "-v",
    `${resolve(output).replaceAll("\\", "/")}:/out`,
    ...environmentArguments,
    image,
    "bash",
    "-c",
    containerScript,
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyPinnedImage();
    mkdirSync(defaultOutput, { recursive: true });
    const result = spawnSync(dockerExecutable(), dockerRunArguments(), { stdio: "inherit", windowsHide: true });
    if (result.status !== 0) throw new Error(`Linux builder container exited with status ${String(result.status)}`);
    process.stdout.write(`office-desktop: Linux deb/AppImage artifacts written to ${defaultOutput}\n`);
  } catch (error) {
    process.stderr.write(`office-desktop: docker linux package failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
