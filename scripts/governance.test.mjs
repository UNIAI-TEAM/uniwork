import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/** Mode Git records for a tracked path (`undefined` when not in the index). */
function gitIndexMode(relPath) {
  const line = execFileSync("git", ["ls-files", "-s", "--", relPath], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!line) return undefined;
  return Number.parseInt(line.split(/\s+/)[0], 8);
}

function gitSymlinkTarget(relPath) {
  return execFileSync("git", ["show", `HEAD:${relPath}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function agentsMdIsSymlink() {
  const agents = path.join(root, "AGENTS.md");
  if (fs.lstatSync(agents).isSymbolicLink()) {
    return fs.readlinkSync(agents) === "CLAUDE.md";
  }
  // Windows often materializes symlinks as plain files when core.symlinks=false.
  if (process.platform === "win32" && gitIndexMode("AGENTS.md") === 0o120000) {
    return gitSymlinkTarget("AGENTS.md") === "CLAUDE.md";
  }
  return false;
}

function agentsMdMatchesClaude() {
  const agents = path.join(root, "AGENTS.md");
  if (fs.lstatSync(agents).isSymbolicLink()) {
    return read("AGENTS.md") === read("CLAUDE.md");
  }
  if (process.platform === "win32" && gitIndexMode("AGENTS.md") === 0o120000) {
    return gitSymlinkTarget("AGENTS.md") === "CLAUDE.md";
  }
  return read("AGENTS.md") === read("CLAUDE.md");
}

function isExecutable(relPath) {
  const abs = path.join(root, relPath);
  if (fs.statSync(abs).mode & 0o111) return true;
  // NTFS has no Unix execute bit; Git stores the mode in the index instead.
  if (process.platform === "win32") {
    const mode = gitIndexMode(relPath);
    return mode !== undefined && (mode & 0o111) !== 0;
  }
  return false;
}

// A governance rule fails in a way no other test notices: nothing breaks, the
// rule simply stops applying and everyone keeps reading the document that says
// it does. These assertions are the only thing standing between "we have rules"
// and "we had rules".

test("AGENTS.md is CLAUDE.md, not a shorter copy of it", () => {
  // Codex, Cursor and Copilot read AGENTS.md and stop there. When it was a
  // 56-line pointer saying "see CLAUDE.md", every agent arriving that way
  // missed the API-compatibility, backend-HTTP, testing and verification rules
  // entirely. A symlink is the only version of this that cannot drift.
  assert.ok(agentsMdIsSymlink(), "AGENTS.md must be a symlink to CLAUDE.md");
  assert.ok(agentsMdMatchesClaude(), "AGENTS.md must resolve to CLAUDE.md content");
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
  for (const hook of ["pre-commit", "commit-msg", "prepare-commit-msg"]) {
    const p = path.join(root, ".githooks", hook);
    assert.ok(fs.existsSync(p), `.githooks/${hook} is missing`);
    // Git will not run a hook without the execute bit, and it says nothing when
    // it skips one — the commit just succeeds.
    assert.ok(isExecutable(`.githooks/${hook}`), `.githooks/${hook} is not executable`);
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
                   "docs/api-sdi-sdo.md",
                   ".github/CODEOWNERS", ".github/pull_request_template.md"]) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is missing`);
  }
});

test("every ADR is numbered once and carries a status", () => {
  // docs/adr/ is where the "why" behind a CLAUDE.md "never" lives. An ADR
  // without a status is a draft nobody closed; two with the same number is a
  // merge that nobody read.
  const files = fs.readdirSync(path.join(root, "docs/adr")).filter((f) => /^\d{4}-.*\.md$/.test(f));
  assert.ok(files.length > 0, "docs/adr has no records");
  const numbers = files.map((f) => f.slice(0, 4));
  assert.equal(new Set(numbers).size, numbers.length, `duplicate ADR numbers: ${numbers.join(", ")}`);
  for (const f of files) {
    assert.match(
      read(`docs/adr/${f}`),
      /^\*\*Trạng thái:\*\* (accepted|superseded by \d{4}|deprecated)/m,
      `docs/adr/${f} needs a "**Trạng thái:** accepted | superseded by NNNN | deprecated" line`,
    );
    assert.ok(read("docs/adr/README.md").includes(`(${f})`), `docs/adr/README.md does not list ${f}`);
  }
});

test("every plan says whether it shipped", () => {
  // Plans are read by agents as if they were current. A plan that shipped a
  // month ago and still reads like a to-do list sends the next agent to
  // re-implement it.
  const dir = "docs/superpowers/plans";
  for (const f of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md"))) {
    assert.match(
      read(`${dir}/${f}`),
      /^> \*\*Trạng thái:\*\* (shipped|in-progress|superseded|abandoned)\b/m,
      `${dir}/${f} needs a "> **Trạng thái:** shipped | in-progress | superseded | abandoned" line under its title`,
    );
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
    return rel ? rel.split(/[/\\]/)[0] : "__barrel__";
  };

  const edges = new Map(modules.map((m) => [m, new Set()]));
  for (const f of walk(CORE)) {
    const owner = path.relative(CORE, f).split(/[/\\]/)[0];
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

  // Tracking dead code is not the same as removing it. The list above was
  // accurate and unchanged for a month; past this date it has to be empty —
  // wire each module to a host or delete it. Move the date only with a
  // reason in the commit body.
  const ORPHANS_DEADLINE = "2026-09-30";
  if (new Date() > new Date(ORPHANS_DEADLINE)) {
    assert.deepEqual(
      orphans, [],
      `packages/core still has unreachable modules after ${ORPHANS_DEADLINE}: ` +
      `${orphans.join(", ")}. Wire them or delete them.`,
    );
  }
});

test("the UniAI tracking glue is wired: script, hook, workflow, rules", () => {
  // docs/engineering/UNIAI_TRACKING.md says every PR names a UNI-nnn issue and
  // every issue-branch commit carries a Refs trailer. Those claims rest on
  // three files; if any goes missing the doc keeps promising what nothing does.
  assert.ok(isExecutable("scripts/uniai.sh"), "scripts/uniai.sh is not executable");
  assert.ok(fs.existsSync(path.join(root, ".github/workflows/uniai-link.yml")), "uniai-link workflow is missing");
  assert.match(read(".github/workflows/uniai-link.yml"), /UNI-\[0-9\]\+/, "uniai-link must grep for UNI-nnn");
  assert.match(read(".githooks/prepare-commit-msg"), /Refs: /, "prepare-commit-msg must add the Refs trailer");
  assert.match(read("CLAUDE.md"), /\n## Project Tracking \(UniAI\)\n/, "CLAUDE.md needs a Project Tracking (UniAI) section");
  for (const t of ["issue-start", "issue-pr", "issue-done", "issue-mine"]) {
    assert.match(read("Makefile"), new RegExp(`^${t}:`, "m"), `Makefile target ${t} is missing`);
  }
});
