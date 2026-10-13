import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function classifyCommit(subject) {
  const parsed = /^(feat|fix|perf|refactor|style|docs|test|build|ci|chore)(?:\(([^)]+)\))?!?:\s+(.+)$/u.exec(subject);
  if (!parsed) return { kind: "review", text: subject };
  const type = parsed[1];
  return { kind: type === "feat" ? "features" : type === "fix" ? "fixes" : ["perf", "refactor", "style"].includes(type) ? "improvements" : "internal", text: parsed[3], scope: parsed[2] ?? "" };
}

export function draftRelease(commits, version, date) {
  const sections = { features: [], improvements: [], fixes: [], review: [], internal: [] };
  for (const commit of commits) {
    const row = classifyCommit(commit.subject);
    // Metadata is draft material, never trusted markup or publishable prose.
    const text = row.text.replace(/[\\`*_{}\[\]<>]/gu, "\\$&");
    sections[row.kind].push(`- [ ] ${text} (${commit.hash.slice(0, 9)})`);
  }
  const labels = { features: "New features", improvements: "Improvements", fixes: "Bug fixes", review: "Needs classification", internal: "Internal changes — review before excluding" };
  return `# v${version} — ${date}\n\nDraft from Git history. Review, rewrite for users, verify availability and translate before publishing.\n\n` +
    Object.entries(sections).filter(([, rows]) => rows.length).map(([kind, rows]) => `## ${labels[kind]}\n\n${rows.join("\n")}\n`).join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = new Map();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--from", "--to", "--version", "--date"].includes(argv[i]) || !argv[i + 1]) throw new Error("Usage: node scripts/changelog-draft.mjs --version 1.1.0 --date YYYY-MM-DD [--from ref] [--to ref]");
    flags.set(argv[i], argv[i + 1]);
  }
  const version = flags.get("--version");
  const date = flags.get("--date");
  if (!/^\d+\.\d+\.\d+$/u.test(version ?? "") || !/^\d{4}-\d{2}-\d{2}$/u.test(date ?? "") || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("Provide a semantic version and a valid release date.");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const records = JSON.parse(readFileSync(resolve(root, "packages/core/changelog/releases.json"), "utf8"));
  const latest = [...records].sort((a, b) => b.date.localeCompare(a.date))[0];
  const from = flags.get("--from") ?? latest?.sourceRef;
  const to = flags.get("--to") ?? "HEAD";
  for (const ref of [from, to]) if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(ref ?? "")) throw new Error("Invalid Git reference.");
  const history = execFileSync("git", ["log", "--no-merges", "--format=%H%x09%s", `${from}..${to}`, "--"], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const commits = history.trim() ? history.trimEnd().split("\n").map((line) => { const tab = line.indexOf("\t"); return { hash: line.slice(0, tab), subject: line.slice(tab + 1) }; }) : [];
  process.stdout.write(draftRelease(commits, version, date));
}
