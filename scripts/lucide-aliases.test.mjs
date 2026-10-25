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

// One on-screen weight for every Lucide icon (docs/conventions.md › Icons ›
// Stroke): base.css makes the stroke non-scaling at 2px.
test("base.css strokes every Lucide icon 2px at every size", () => {
  const css = readFileSync("packages/ui/styles/base.css", "utf8");
  assert.match(css, /svg\.lucide \{ stroke-width: 2; \}/);
  assert.match(css, /svg\.lucide :where\([^)]*\) \{ vector-effect: non-scaling-stroke; \}/);
});

// The Lucide icons a file imports, under the local names it renders them by.
function lucideNames(src) {
  const names = new Set();
  for (const match of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g)) {
    for (const spec of match[1].split(",")) {
      const local = spec.replace(/^\s*type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (local) names.add(local);
    }
  }
  return names;
}

// Each `<Name …>` tag up to the `>` that closes it: braces and quoted strings
// are skipped, so an arrow function or a `[&>svg]` class does not end it.
function tags(src, name) {
  const out = [];
  for (const m of src.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "g"))) {
    let depth = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

// The scale in docs/conventions.md › Icons › Size: 12, 14, 16, 20px, then 24px and up.
const onScale = (n) => ["3", "3.5", "4", "5"].includes(n) || (Number.isInteger(Number(n)) && Number(n) >= 6);

function iconOffences() {
  const files = execSync(`git ls-files -- '*.tsx' | grep -v '^packages/office-upstream/upstream/' || true`, {
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && !/\.(test|stories)\.tsx$/.test(file));
  const stroke = {};
  const size = {};
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("lucide-react")) continue;
    for (const name of lucideNames(src)) {
      for (const tag of tags(src, name)) {
        if (/\b(strokeWidth|absoluteStrokeWidth)\b/.test(tag)) stroke[file] = (stroke[file] ?? 0) + 1;
        for (const [, n] of tag.matchAll(/(?:^|[\s"'`:])size-(\d+(?:\.\d+)?)/g)) {
          if (!onScale(n)) size[file] = (size[file] ?? 0) + 1;
        }
      }
    }
  }
  return { stroke, size };
}

test("no Lucide icon sets its own stroke width", () => {
  assert.deepEqual(iconOffences().stroke, {}, "a Lucide icon's stroke comes from base.css; drop the prop");
});

test("every Lucide icon sits on the size scale", () => {
  assert.deepEqual(iconOffences().size, {}, "use size-3, 3.5, 4, 5 or 6 and up");
});

// A loading glyph is <Spinner /> (packages/ui/components/ui/spinner.tsx): one
// size default, one accessible-name rule and one reduced-motion behaviour.
test("spinners go through Spinner, not a raw LoaderCircle", () => {
  const hits = execSync(
    `git grep -nF "<LoaderCircle" -- 'packages/*.tsx' 'apps/*.tsx' ':!packages/ui/components/ui/spinner.tsx' ':!packages/office-upstream/upstream/**' || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `raw spinners:\n${hits}`);
});
