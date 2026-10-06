// The CF/DV round-trips save through the REAL patched gateway artifact that
// scripts/office/build-upstream.mjs writes (bindXlsxGateway refuses a bundle
// built without patch 0010 since da863e33, so the old per-test esbuild of the
// unpatched upstream source - and its never-refreshed cache, review m-5 - is
// gone). Same contract as xlsx-visuals.test.ts: locally a missing artifact
// skips with a warning; REQUIRE_XLSX_GATEWAY=1 (the cloud round) fails.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "vitest";
import { bindXlsxGateway, type XlsxGatewayFunctions } from "../src/xlsx";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const BUILD_HINT = "run node scripts/office/build-upstream.mjs to build .go-tmp/office-upstream-build/dist/xlsx-gateway.mjs";

export async function loadPatchedGateway(): Promise<XlsxGatewayFunctions> {
  return bindXlsxGateway((await import(pathToFileURL(ARTIFACT).href)) as never);
}

/** `describe` over the patched gateway, or the skip / required-failure stub. */
export function describeWithPatchedGateway(name: string, body: () => void): void {
  if (existsSync(ARTIFACT)) {
    describe(name, body);
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
