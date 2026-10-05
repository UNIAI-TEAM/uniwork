import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The fixture parse map exists for these tests only: production code must bind
// the real vendored upstream (packages/office-upstream), never a hand-rolled
// scanner. Any non-test file under packages/views that imports it fails here.

// ops -> visual -> html -> office -> views
const VIEWS = join(__dirname, "..", "..", "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next" || name === "dist") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the ops test fixture stays test-only", () => {
  it("no production source under packages/views imports test-fixture", () => {
    const offenders = files(VIEWS)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx") && !file.endsWith("test-fixture.ts"))
      .filter((file) => /from\s+["'][^"']*test-fixture["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(VIEWS, file));
    expect(offenders).toEqual([]);
  });
});
