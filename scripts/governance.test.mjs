import { describe, test } from "node:test";
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

test("no editor-specific rules tree is tracked beside AGENTS.md", () => {
  // CLAUDE.md § Local Gates: Cursor, Codex and Copilot read AGENTS.md; a second
  // ruleset beside it drifts silently. .cursor/ came back once as 825 tracked
  // files under a .gitignore entry that already excluded it (`git add -f`).
  const tracked = execFileSync("git", ["ls-files", "--", ".cursor", ".cursorrules", ".wsl-*.sh"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assert.equal(tracked, "", `tracked editor/personal files:\n${tracked}`);
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

const historicalCommitExceptions = new Map([
  ["e88a05532ceb9b820a64d583fea43685457facd6", "Enhance UI components with transition classes and improve localization"],
  ["c416bc6f1fee784862607faa4a8cd2519f252b2f", "add env"],
  ["e6eaf72d530ee4b03481797e874c48fa99c55145", "change to new domain"],
  ["d95c9fe14681711d109556f4cff0976c03d692c6", "change AI_PROVIDER"],
  ["78e441abd9f861ea0cc1d19fae35c47129b31239", "(deploy): change AI_PROVIDER"],
  ["9c94b49eb656ba34ad9cf3415aa13746400d912c", "(test): fix test billing_vnpay_test.go"],
  ["1f375e0f006bbac633448fcbfe0478dada0afbd1", "UNI-1808 (feat): spec và plan tích hợp pavietnam"],
]);

function rejectedCommitSubjects(commits, types) {
  const re = new RegExp(`^(${types})(\\([a-z0-9._/-]+\\))?: .+`);
  return commits.filter(({ sha, subject }) =>
    historicalCommitExceptions.get(sha) !== subject &&
    !re.test(subject) &&
    !/^(Merge|Revert|fixup!|squash!|amend!|UNI-\d+:)/.test(subject),
  ).map(({ subject }) => subject);
}

test("the commit-msg hook accepts this repo's whole history", () => {
  // A rule that would have rejected the commits already in the tree is not a
  // rule, it is a trap for the next person who writes a correct message.
  //
  // e88a055 landed on develop via PR #62; c416bc6, e6eaf72d5, d95c9fe14,
  // 78e441abd and 9c94b49eb were pushed straight to develop without a conventional prefix. Shared history cannot
  // be rewritten; pin both SHA and subject so a new commit cannot reuse an
  // exempt subject to escape this check.
  const commits = execFileSync("git", ["log", "--format=%H%x00%s"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map(line => { const [sha, subject] = line.split("\0"); return { sha, subject }; });
  const types = read(".githooks/commit-msg").match(/^TYPES="([^"]+)"/m)[1];
  const rejected = rejectedCommitSubjects(commits, types);
  assert.deepEqual(rejected, [], "commit-msg would reject commits already in history");
});

test("historical message exceptions only allow their immutable commit and subject", () => {
  const types = read(".githooks/commit-msg").match(/^TYPES="([^"]+)"/m)[1];
  for (const [sha, subject] of historicalCommitExceptions) {
    assert.deepEqual(rejectedCommitSubjects([{ sha, subject }], types), []);
    assert.deepEqual(rejectedCommitSubjects([{ sha: "f".repeat(40), subject }], types), [subject]);
    assert.deepEqual(rejectedCommitSubjects([{ sha, subject: "another invalid message" }], types), ["another invalid message"]);
  }
  assert.deepEqual(rejectedCommitSubjects([{ sha: "f".repeat(40), subject: "fix(changelog): validate content" }], types), []);
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

test("GATE_LEVEL is one word and every gate that claims to read it does", () => {
  // docs/engineering/GATE_LEVELS.md lists which files loosen with the level.
  // A reader that stops reading the file keeps enforcing one level forever
  // while the doc says otherwise; a fourth word in the file would resolve to
  // strict everywhere and nobody would notice why.
  const level = read("GATE_LEVEL").trim();
  assert.ok(["fast", "standard", "strict"].includes(level), `GATE_LEVEL is "${level}"; expected fast | standard | strict`);
  for (const f of [".githooks/pre-commit", "scripts/check.sh", ".github/workflows/ci.yml",
                   ".github/workflows/uniai-link.yml", "docs/engineering/DEFINITION_OF_DONE.md",
                   "docs/engineering/FEATURE_WORKFLOW.md",
                   "scripts/coverage-gate.ts", "scripts/lint-gate.sh"]) {
    assert.match(read(f), /GATE_LEVEL/, `${f} is listed in GATE_LEVELS.md as a reader but never mentions GATE_LEVEL`);
    assert.ok(read("docs/engineering/GATE_LEVELS.md").includes(`\`${f}\``), `GATE_LEVELS.md does not list ${f}`);
  }
  assert.match(read("CLAUDE.md"), /\n## Gate Level\n/, "CLAUDE.md needs a Gate Level section");
  for (const w of ["fast", "standard", "strict"]) {
    assert.ok(read("CLAUDE.md").split("\n## Gate Level\n")[1].split("\n## ")[0].includes(`\`${w}\``), `CLAUDE.md § Gate Level does not name ${w}`);
  }
  // The four [fast] items are the floor; they are the same in both files.
  const fast = (t) => [...t.matchAll(/\*\*([^*]+)\*\* `\[fast\]`/g)].map((m) => m[1]).sort();
  assert.equal(fast(read("docs/engineering/DEFINITION_OF_DONE.md")).length, 4, "DoD marks exactly four [fast] items");
  assert.deepEqual(fast(read(".github/pull_request_template.md")), fast(read("docs/engineering/DEFINITION_OF_DONE.md")));
});

test("the PR template ticks exactly the DoD items the DoD page lists", () => {
  // DEFINITION_OF_DONE.md explains each item and how to check it; the PR
  // template is where it is actually ticked. Two lists drift the moment one
  // is edited alone, and the one people read is the template.
  const labels = (text, re) => [...text.matchAll(re)].map((m) => m[1]).sort();
  const page = labels(read("docs/engineering/DEFINITION_OF_DONE.md"), /^\d+\. \*\*([^*]+)\*\*/gm);
  const template = labels(read(".github/pull_request_template.md"), /^- \[ \] \*\*([^*]+)\*\*/gm);
  assert.ok(page.length >= 8 && page.length <= 12, `DoD has ${page.length} items; keep it around ten`);
  assert.deepEqual(template, page, "PR template and DEFINITION_OF_DONE.md list different DoD items");
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
                   e.name !== "test" && e.name !== "node_modules" &&
                   // vitest --coverage output (gitignored), not source
                   e.name !== "coverage")
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
  const ORPHANS_DEADLINE = "2026-10-31";
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
  // No issue, no code, at every level: fast must not turn a missing key into a warning.
  assert.doesNotMatch(read(".github/workflows/uniai-link.yml"), /=\s*fast\b/, "uniai-link must not special-case fast");
  assert.match(
    read(".githooks/commit-msg"),
    /UNI-\[0-9\]\*:/,
    "commit-msg must accept squash-merged UniAI PR titles (UNI-nnn: …)",
  );
  assert.match(read(".githooks/prepare-commit-msg"), /Refs: /, "prepare-commit-msg must add the Refs trailer");
  assert.match(read("CLAUDE.md"), /\n## Project Tracking \(UniAI\)\n/, "CLAUDE.md needs a Project Tracking (UniAI) section");
  for (const t of ["issue-start", "issue-pr", "issue-done", "issue-mine"]) {
    assert.match(read("Makefile"), new RegExp(`^${t}:`, "m"), `Makefile target ${t} is missing`);
  }
});

describe("ADR 0011 — apps/chat-mobile", () => {
  // The mobile app imports only types and pure functions from packages/core.
  // usf's sibling boundary is convention only, and its barrels pull TanStack,
  // zustand and the web ApiClient into Metro. Here the boundary is files that
  // must exist the day the app does; while it does not, there is nothing to hold.
  const app = "apps/chat-mobile";
  const exists = (p) => fs.existsSync(path.join(root, p));
  const eslintConfig = () =>
    exists(app) ? fs.readdirSync(path.join(root, app)).find((f) => /^eslint\.config\.[cm]?[jt]s$/.test(f)) : undefined;

  test("the app carries its own CLAUDE.md", { skip: !exists(app) && "apps/chat-mobile does not exist yet" }, () => {
    assert.ok(exists(`${app}/CLAUDE.md`), `${app}/CLAUDE.md is missing`);
  });

  test("the import boundary is a lint rule, not a convention", { skip: !exists(app) && "apps/chat-mobile does not exist yet" }, () => {
    const cfg = eslintConfig();
    assert.ok(cfg, `${app} has no eslint.config.*`);
    const text = read(`${app}/${cfg}`);
    assert.match(text, /no-restricted-imports/, `${app}/${cfg} must use no-restricted-imports`);
    assert.match(text, /@uniwork\/views/, `${app}/${cfg} must restrict @uniwork/views`);
  });

  test("mobile verifies in its own workflow and stays out of the main CI filter", { skip: !exists(app) && "apps/chat-mobile does not exist yet" }, () => {
    assert.ok(exists(".github/workflows/mobile-verify.yml"), "mobile-verify workflow is missing");
    assert.match(read(".github/workflows/ci.yml"), /!@uniwork\/chat-mobile/, "ci.yml must filter out @uniwork/chat-mobile");
  });

  test("the nightly keeps its test account out of public artifacts and setup steps", { skip: !exists(app) && "apps/chat-mobile does not exist yet" }, () => {
    // The repository is public: anyone can download a workflow artifact, and
    // GitHub masks secrets in logs only. Maestro's command log records what
    // each inputText typed (the test password); screenshots are all a failure
    // needs. The account reaches only the steps that run Maestro, not the
    // install, prebuild and installer script before them (UNI-1838).
    const wf = read(".github/workflows/chat-mobile-verify.yml");
    for (const [, upload] of wf.matchAll(/^\s+path: (.+)$/gm)) {
      if (upload.includes(".maestro")) assert.match(upload, /\*\.png$/, `uploads ${upload}: only Maestro screenshots may leave the runner`);
    }
    for (const job of wf.split(/^ {2}(?=[a-z]+:$)/m).filter((j) => /^(ios|android):/.test(j))) {
      const [head, ...steps] = job.split(/^ {6}- /m);
      assert.doesNotMatch(head, /MAESTRO_TEST_/, `${job.split(":")[0]}: the test account belongs on the Maestro steps, not the job env`);
      for (const step of steps.filter((s) => s.includes("MAESTRO_TEST_"))) {
        assert.match(step, /maestro (--device \S+ )?test /, `a step that does not run Maestro gets the test account:\n${step}`);
      }
    }
  });
});
