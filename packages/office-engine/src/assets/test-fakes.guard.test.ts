import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The seam fakes exist for unit tests only (G2-06 brief: "fake only in unit
// tests"). Any production file under src/ that imports them fails here.
const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("test fakes stay test-only", () => {
  it("no production source imports test-fakes", () => {
    const offenders = files(SRC)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("test-fakes.ts"))
      .filter((f) => /from\s+["'][^"']*test-fakes["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
