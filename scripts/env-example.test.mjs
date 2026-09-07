import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";

// .env.example claims to list every variable the server reads ("anything not
// listed is not a knob"). This keeps the claim true: every os.Getenv / getenv
// key in non-test Go code appears as a line the operator can uncomment.
test("every variable the server reads is documented in .env.example", () => {
  const example = fs.readFileSync(".env.example", "utf8");
  const documented = new Set(
    [...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
  );
  const keys = execSync(
    `grep -rhoE 'Getenv\\("[A-Z_0-9]+"\\)|getenv\\("[A-Z_0-9]+"' server --include='*.go' --exclude='*_test.go' || true`,
    { encoding: "utf8" },
  )
    .match(/[A-Z][A-Z0-9_]{2,}/g) ?? [];
  const missing = [...new Set(keys)].filter((k) => !documented.has(k)).sort();
  assert.deepEqual(missing, [], `add these to .env.example: ${missing.join(", ")}`);
});
