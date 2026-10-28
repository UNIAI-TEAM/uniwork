import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ADR 0047 §5, spec §4.5: every command that takes a step-up token runs
// through the one proof dialog, useStepUpGate() in
// settings/components/step-up-proof.tsx. The person is asked the same way
// everywhere, a held token is spent before anyone is asked, and a refused
// proof asks again instead of failing. The commands are the core hooks that
// send the held token (their body reads stepUpToken() or withTransferProof());
// a screen that called one without the gate could only ever show
// proof_required, with no way to answer it.
const VIEWS = __dirname;
const CORE = join(__dirname, "../core");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "coverage-tmp") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The core hooks whose body sends the held step-up token. */
function stepUpHooks(): string[] {
  const hooks = new Set<string>();
  for (const file of sources(CORE)) {
    for (const m of readFileSync(file, "utf8").matchAll(/^export function (use[A-Z]\w*)\([\s\S]*?^}$/gm)) {
      if (/\b(stepUpToken|withTransferProof)\(/.test(m[0])) hooks.add(m[1]!);
    }
  }
  return [...hooks].sort();
}

/** The file renders the gate, itself or through a module it imports (SwitchWizard carries it for the invite screens). */
function gated(file: string, text: string): boolean {
  if (text.includes("useStepUpGate(")) return true;
  for (const m of text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
    const base = resolve(dirname(file), m[1]!);
    const target = [`${base}.tsx`, `${base}.ts`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
    if (target && readFileSync(target, "utf8").includes("useStepUpGate(")) return true;
  }
  return false;
}

describe("the step-up proof gate", () => {
  const hooks = stepUpHooks();

  // A new command that sends the token lands here first, so whoever adds it
  // sees this rule; one that stops sending it leaves the list.
  it("knows every command that sends the held token", () => {
    expect(hooks).toEqual([
      "useAcceptInvite",
      "useDeleteAccount",
      "useJoinMembershipInviteLink",
      "useLinkSignInTicket",
      "useMfaConfirm",
      "useMfaSetup",
      "useSetPassword",
      "useStartSignInMethodLink",
      "useTransferOwnership",
      "useUnlinkSignInMethod",
    ]);
  });

  it("stands in front of every screen that runs one", () => {
    const ungated: string[] = [];
    let callers = 0;
    for (const file of sources(VIEWS)) {
      const text = readFileSync(file, "utf8");
      const used = hooks.filter((hook) => new RegExp(`\\b${hook}\\(`).test(text));
      if (used.length === 0) continue;
      callers += 1;
      if (!gated(file, text)) ungated.push(`${relative(VIEWS, file)}: ${used.join(", ")}`);
    }
    expect(callers, "no screen calls a step-up command: the scan slipped").toBeGreaterThan(5);
    expect(ungated).toEqual([]);
  });
});
