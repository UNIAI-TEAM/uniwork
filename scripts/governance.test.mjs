import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// A governance rule fails in a way no other test notices: nothing breaks, the
// rule simply stops applying and everyone keeps reading the document that says
// it does. These assertions are the only thing standing between "we have rules"
// and "we had rules".

test("AGENTS.md is CLAUDE.md, not a shorter copy of it", () => {
  // Codex, Cursor and Copilot read AGENTS.md and stop there. When it was a
  // 56-line pointer saying "see CLAUDE.md", every agent arriving that way
  // missed the API-compatibility, backend-HTTP, testing and verification rules
  // entirely. A symlink is the only version of this that cannot drift.
  const stat = fs.lstatSync(path.join(root, "AGENTS.md"));
  assert.ok(stat.isSymbolicLink(), "AGENTS.md must be a symlink to CLAUDE.md");
  assert.equal(fs.readlinkSync(path.join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(read("AGENTS.md"), read("CLAUDE.md"));
});

test("pnpm install wires core.hooksPath at .githooks", () => {
  // Git hooks are not cloned. Without this line in `prepare`, .githooks/ is a
  // directory of shell scripts nobody runs, and every gate below it is theatre.
  const pkg = JSON.parse(read("package.json"));
  assert.match(
    pkg.scripts?.prepare ?? "",
    /git config core\.hooksPath \.githooks/,
    "root package.json needs a `prepare` script pointing core.hooksPath at .githooks",
  );
});

test("both hooks exist and are executable", () => {
  for (const hook of ["pre-commit", "commit-msg"]) {
    const p = path.join(root, ".githooks", hook);
    assert.ok(fs.existsSync(p), `.githooks/${hook} is missing`);
    // Git will not run a hook without the execute bit, and it says nothing when
    // it skips one — the commit just succeeds.
    assert.ok(fs.statSync(p).mode & 0o111, `.githooks/${hook} is not executable`);
  }
});

test("the commit-msg hook enforces exactly the prefixes CLAUDE.md documents", () => {
  const hookTypes = new Set(
    read(".githooks/commit-msg")
      .match(/^TYPES="([^"]+)"/m)[1]
      .split("|"),
  );

  const commitsSection = read("CLAUDE.md").split("\n## Commits\n")[1].split("\n## ")[0];
  const documentedTypes = new Set(
    [...commitsSection.matchAll(/`([a-z]+)(?:\(scope\))?`/g)].map((m) => m[1]),
  );

  assert.deepEqual(
    [...documentedTypes].sort(),
    [...hookTypes].sort(),
    "CLAUDE.md § Commits and .githooks/commit-msg disagree about the allowed prefixes",
  );
});

test("the commit-msg hook accepts this repo's whole history", () => {
  // A rule that would have rejected the commits already in the tree is not a
  // rule, it is a trap for the next person who writes a correct message.
  const subjects = execFileSync("git", ["log", "--format=%s"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const types = read(".githooks/commit-msg").match(/^TYPES="([^"]+)"/m)[1];
  const re = new RegExp(`^(${types})(\\([a-z0-9._/-]+\\))?: .+`);
  const rejected = subjects.filter(
    (s) => !re.test(s) && !/^(Merge|Revert|fixup!|squash!|amend!)/.test(s),
  );
  assert.deepEqual(rejected, [], "commit-msg would reject commits already in history");
});

test("make doctor reads pinned versions from the files that own them", () => {
  // Duplicating a version number into a check script is how the check ends up
  // enforcing a version nobody uses any more.
  const doctor = read("scripts/doctor.sh");
  assert.match(doctor, /\.nvmrc/, "doctor must read the Node version from .nvmrc");
  assert.match(doctor, /server\/go\.mod/, "doctor must read the Go version from server/go.mod");
  assert.match(doctor, /packageManager/, "doctor must read the pnpm version from package.json");

  // And the pins have to exist.
  assert.match(read(".nvmrc").trim(), /^\d+$/);
  assert.match(read("server/go.mod"), /^go \d+\.\d+/m);
  assert.match(JSON.parse(read("package.json")).packageManager ?? "", /^pnpm@\d+\.\d+\.\d+$/);
});

test("the docs a newcomer is pointed at exist", () => {
  // CONTRIBUTING.md links these by name. A dead link in the onboarding path is
  // the first thing a new contributor learns about how much the docs are worth.
  for (const f of ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md",
                   "PRODUCT.md", "README.md", "docs/conventions.md",
                   ".github/CODEOWNERS", ".github/pull_request_template.md"]) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is missing`);
  }
});

// --- The ruleset must describe the repo that exists --------------------------
//
// CLAUDE.md is injected into every agent session before it reads any code, so a
// sentence in it outranks the code for anyone who trusts it. That is the whole
// value, and it is also the failure mode: a rule describing a structure that is
// not there teaches every agent and every newcomer to build toward a diagram
// nobody implemented. Both assertions below existed as facts long before they
// existed as tests, and both were wrong by the time anyone checked.

test("every path CLAUDE.md names still exists", () => {
  const doc = read("CLAUDE.md");
  const named = new Set([
    ...[...doc.matchAll(/`([\w./@-]+\.(?:ts|tsx|go|json|css|mjs|sql|md|yml|sh))`/g)].map((m) => m[1]),
    ...[...doc.matchAll(/`([\w./-]+\/)`/g)].map((m) => m[1]),
  ]);
  // `@uniwork/*` are package specifiers, not paths on disk.
  const dead = [...named].filter((f) => !f.startsWith("@") && !fs.existsSync(path.join(root, f)));
  assert.deepEqual(dead, [], "CLAUDE.md points at files that are not there");
});

test("CLAUDE.md lists exactly the packages/core modules no host reaches", () => {
  // Reachability, not "is it imported anywhere": analytics/, diagnostics/ and
  // shortcuts/ all import each other, so a naive importer count calls the whole
  // dead cluster alive. Walk out from what apps/ and packages/{views,ui} really
  // pull in, follow core-to-core edges, and whatever is left is unreachable.
  const CORE = "packages/core";
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const specifiers = (file) =>
    [...read(file).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

  const modules = fs.readdirSync(path.join(root, CORE), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") &&
                   e.name !== "test" && e.name !== "node_modules")
    .map((e) => e.name);

  // A specifier resolves to a top-level core module, the core barrel, or nothing.
  const target = (spec, from) => {
    let rel;
    if (spec.startsWith("@uniwork/core")) rel = spec.replace(/^@uniwork\/core\/?/, "");
    else if (spec.startsWith(".") && from.startsWith(CORE)) {
      rel = path.relative(CORE, path.resolve(path.dirname(from), spec));
      if (rel.startsWith("..")) return null;
    } else return null;
    return rel ? rel.split("/")[0] : "__barrel__";
  };

  const edges = new Map(modules.map((m) => [m, new Set()]));
  for (const f of walk(CORE)) {
    const owner = path.relative(CORE, f).split("/")[0];
    if (!edges.has(owner)) continue;
    for (const spec of specifiers(f)) {
      const t = target(spec, f);
      if (t && t !== owner && edges.has(t)) edges.get(owner).add(t);
    }
  }

  const roots = new Set();
  for (const dir of ["apps", "packages/views", "packages/ui"]) {
    for (const f of walk(dir)) for (const spec of specifiers(f)) {
      const t = target(spec, f);
      if (t === "__barrel__") specifiers(`${CORE}/index.ts`).forEach((b) => {
        const bt = target(b, `${CORE}/index.ts`);
        if (bt && edges.has(bt)) roots.add(bt);
      });
      else if (t && edges.has(t)) roots.add(t);
    }
  }

  const live = new Set();
  const visit = (m) => { if (live.has(m)) return; live.add(m); (edges.get(m) ?? []).forEach(visit); };
  roots.forEach(visit);
  const orphans = modules.filter((m) => !live.has(m)).sort();

  const shape = read("CLAUDE.md").split("\n## Project Shape\n")[1].split("\n## ")[0];
  const core = shape.split("- `packages/core/`")[1].split("\n- `")[0];
  const documented = [...core.matchAll(/`packages\/core\/([a-z-]+)\/`/g)]
    .map((m) => m[1]).sort();

  assert.deepEqual(
    documented, orphans,
    "CLAUDE.md § Project Shape and packages/core disagree about which modules " +
    "are unreachable. Wired one up? Remove it from the list. Added a new " +
    "orphan? Say so, or delete it.",
  );
});
