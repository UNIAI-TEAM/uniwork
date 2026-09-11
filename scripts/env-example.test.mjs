import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function walkGo(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkGo(p, out);
    else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) out.push(p);
  }
  return out;
}

// .env.example claims to list every variable the server reads ("anything not
// listed is not a knob"). This keeps the claim true: every os.Getenv / getenv
// key in non-test Go code appears as a line the operator can uncomment.
test("every variable the server reads is documented in .env.example", () => {
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const documented = new Set(
    [...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
  );
  const getenv = /(?:Get|get)env\("([A-Z][A-Z0-9_]{2,})"\)/g;
  const keys = new Set();
  for (const file of walkGo(path.join(root, "server"))) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(getenv)) keys.add(m[1]);
  }
  const missing = [...keys].filter((k) => !documented.has(k)).sort();
  assert.deepEqual(missing, [], `add these to .env.example: ${missing.join(", ")}`);
});
