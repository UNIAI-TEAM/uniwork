import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { canonicalFor, lucideDeprecatedAliases } from "./lucide-aliases.mjs";

const committed = JSON.parse(readFileSync("packages/eslint-config/lucide-aliases.json", "utf8"));

// The ESLint guard (packages/eslint-config/base.js › lucideAliasPaths) reads
// this list; a lucide-react bump that renames icons must refresh it.
test("the committed alias list matches the installed lucide-react", () => {
  assert.deepEqual(committed, lucideDeprecatedAliases(), "run: pnpm generate:lucide-aliases");
});

// Lint reports without failing at GATE_LEVEL=fast (ADR 0014), so the import
// ban is also held here, where it fails at every level.
test("no source file imports a deprecated lucide alias", () => {
  const files = execSync(
    `git ls-files -- '*.ts' '*.tsx' '*.mts' '*.js' '*.jsx' '*.mjs' | grep -v '^packages/office-upstream/upstream/' || true`,
    { encoding: "utf8" },
  ).split("\n").filter(Boolean);
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g;
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("lucide-react")) continue;
    for (const match of src.matchAll(importRe)) {
      for (const spec of match[1].split(",")) {
        const name = spec.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (Object.hasOwn(committed, name)) hits.push(`${file}: ${name} → ${canonicalFor(name, committed[name])}`);
      }
    }
  }
  assert.deepEqual(hits, [], `deprecated lucide aliases:\n${hits.join("\n")}`);
});
