// The XLSX round-trips save through the REAL patched gateway artifact that
// scripts/office/build-upstream.mjs writes (bindXlsxGateway refuses a bundle
// built without patch 0010 since da863e33). Contract: locally a missing
// artifact skips with a warning; REQUIRE_XLSX_GATEWAY=1 (the cloud round)
// fails. An artifact that exists but was built from other patches or another
// upstream pin than the checkout (or has no build record) FAILS in both modes:
// a stale bundle must never test old gateway code silently.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "vitest";
import { bindXlsxGateway, type XlsxGatewayFunctions } from "../src/xlsx";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BUILD_DIR = join(REPO, ".go-tmp", "office-upstream-build");
export const ARTIFACT = join(BUILD_DIR, "dist", "xlsx-gateway.mjs");
const BUILD_CMD = "node scripts/office/build-upstream.mjs";
const BUILD_HINT = `run ${BUILD_CMD} to build .go-tmp/office-upstream-build/dist/xlsx-gateway.mjs`;

const sha256Hex = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

interface BuildRecord {
  patchesApplied?: { patch?: string; sha256?: string }[];
  steps?: { step?: string; detail?: string }[];
  vendoredFilesDigest?: string | null;
}

/**
 * Problems that make a built gateway bundle stale against the checkout: the
 * patch list/hashes in the build record, the vendored upstream pin and the
 * vendored-file digest (provenance integrity.filesDigest) the
 * record's provenance step saw. Empty array = fresh.
 */
export function gatewayStaleness(paths: { patchesDir: string; recordPath: string; provenancePath: string }): string[] {
  if (!existsSync(paths.recordPath)) return [`no build record at ${paths.recordPath}`];
  let record: BuildRecord;
  try {
    record = JSON.parse(readFileSync(paths.recordPath, "utf8")) as BuildRecord;
  } catch {
    return ["build record is not valid JSON"];
  }
  const problems: string[] = [];
  const current = existsSync(paths.patchesDir) ? readdirSync(paths.patchesDir).filter((f) => f.endsWith(".patch")).sort() : [];
  const applied = record.patchesApplied ?? [];
  for (const name of current) {
    const built = applied.find((a) => a.patch === name);
    if (!built) problems.push(`patch ${name} is not in the built bundle`);
    else if (built.sha256 !== sha256Hex(join(paths.patchesDir, name))) problems.push(`patch ${name} changed since the bundle was built`);
  }
  for (const a of applied) if (a.patch && !current.includes(a.patch)) problems.push(`built bundle applied ${a.patch}, which no longer exists`);
  if (!problems.length && applied.map((a) => a.patch).join("\n") !== current.join("\n")) problems.push("patch order differs from the built bundle");
  if (existsSync(paths.provenancePath)) {
    const prov = JSON.parse(readFileSync(paths.provenancePath, "utf8")) as { fileCount?: number; upstream?: { pinnedCommit?: string }; integrity?: { filesDigest?: string } };
    const want = `${prov.fileCount} files match ${String(prov.upstream?.pinnedCommit).slice(0, 12)}`;
    const got = record.steps?.find((s) => s.step === "provenance")?.detail;
    if (got !== want) problems.push(`upstream provenance changed (bundle built with "${got ?? "none"}", checkout is "${want}")`);
    const digest = prov.integrity?.filesDigest;
    if (digest && record.vendoredFilesDigest !== digest) problems.push(`vendored upstream sources changed (bundle digest ${record.vendoredFilesDigest ?? "none"}, checkout ${digest})`);
  }
  return problems;
}

const currentStaleness = (): string[] =>
  gatewayStaleness({
    patchesDir: join(REPO, "packages", "office-upstream", "patches"),
    recordPath: join(BUILD_DIR, "build-record.json"),
    provenancePath: join(REPO, "packages", "office-upstream", "provenance.json"),
  });

export async function loadPatchedGateway(): Promise<XlsxGatewayFunctions> {
  return bindXlsxGateway((await import(pathToFileURL(ARTIFACT).href)) as never);
}

/** `describe` over the patched gateway, or the skip / required-failure / stale-failure stub. */
export function describeWithPatchedGateway(name: string, body: () => void): void {
  if (existsSync(ARTIFACT)) {
    const stale = currentStaleness();
    if (stale.length === 0) {
      describe(name, body);
    } else {
      describe(name, () => {
        it("needs a gateway bundle built from the current patches", () => {
          throw new Error(`the xlsx gateway bundle is stale (${stale.join("; ")}): rebuild with ${BUILD_CMD}`);
        });
      });
    }
  } else if (process.env.REQUIRE_XLSX_GATEWAY === "1") {
    describe(name, () => {
      it("needs the xlsx gateway artifact when REQUIRE_XLSX_GATEWAY=1", () => {
        throw new Error(`REQUIRE_XLSX_GATEWAY=1 but the xlsx gateway bundle is missing: ${BUILD_HINT}`);
      });
    });
  } else {
    console.warn(`${name}: skipping the real-gateway round-trip (${BUILD_HINT}; set REQUIRE_XLSX_GATEWAY=1 to fail instead)`);
  }
}
