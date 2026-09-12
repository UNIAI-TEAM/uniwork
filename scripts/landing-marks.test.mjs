import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

const lock = JSON.parse(fs.readFileSync(path.join(root, "scripts/landing/marks.lock.json"), "utf8"));
const generated = fs.readFileSync(
  path.join(root, "apps/web/features/landing/provider-marks.generated.ts"),
  "utf8",
);
const sha = (s) => createHash("sha256").update(s).digest("hex");

// The trust band draws three third-party marks. They are vendored, not
// redrawn, and these tests are the reason nobody has to take that on trust:
// the first proves the committed paths are still the upstream paths, the
// second proves the module and the lock were written by the same run.
test("every vendored mark still matches the upstream artwork", () => {
  const pkgDir = path.dirname(require.resolve("@lobehub/icons-static-svg/package.json"));
  const drifted = [];
  for (const [slug, meta] of Object.entries(lock.marks)) {
    const file = path.join(pkgDir, meta.source);
    if (!fs.existsSync(file)) {
      drifted.push(`${slug}: ${meta.source} is gone from the package`);
      continue;
    }
    if (sha(fs.readFileSync(file, "utf8")) !== meta.source_sha256) {
      drifted.push(`${slug}: upstream artwork changed`);
    }
  }
  assert.deepEqual(drifted, [], `run \`pnpm landing:marks\`;\n${drifted.join("\n")}`);
});

test("the generated module carries exactly the paths the lock recorded", () => {
  const paths = [...generated.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);
  const wrong = [];
  const slugs = Object.keys(lock.marks);
  assert.equal(paths.length, slugs.length, "module and lock disagree on how many marks there are");
  slugs.forEach((slug, i) => {
    if (sha(paths[i]) !== lock.marks[slug].path_sha256) wrong.push(slug);
  });
  assert.deepEqual(wrong, [], `edited by hand? run \`pnpm landing:marks\`: ${wrong.join(", ")}`);
});

// The band's whole point is that the marks track the page's text colour in
// both themes. A vendored path with its own fill would break that silently.
test("no vendored mark carries its own colour", () => {
  assert.equal(/fill="#|fill='#|fill:\s*#/.test(generated), false, "a mark hardcodes a colour");
});
