#!/usr/bin/env node
// One-click rollback of a UniChat OTA update from CI (audit "no-ci-rollback"): .github/workflows/
// chat-mobile-rollback.yml runs it with the signing key the chat-mobile-update environment holds, so stopping a bad
// update never needs a laptop with the private key (which the runbook says to delete after setup). Three moves:
//
//   revert-rollout         an update still rolling out: phones in the rollout go back to the update before it
//                          (`eas update:revert-update-rollout`); what the hourly release-health job does itself.
//   republish-previous     an update out to every phone: the update before it on the same runtime is published
//                          again, signed, and becomes the newest (`eas update:republish`).
//   roll-back-to-embedded  phones on that runtime go back to the bundle inside their binary
//                          (`eas update:roll-back-to-embedded`), when no earlier update is good.
//
//   node scripts/mobile-ota-rollback.mjs --action <move> --channel <channel> --platform android|ios --reason "<why>"
//        [--group <update group>] [--runtime-version <fingerprint>] [--dry-run]
//     env: EAS_UPDATE_PRIVATE_KEY_PATH (required unless --dry-run: phones refuse an unsigned update)
//
// The plan is worked out from `eas update:list` before anything is published (plan(), tested without eas), and is
// refused when it would not do what the person asked: reverting a rollout that is not rolling, republishing over an
// update that a newer one already replaced, or rolling back with no runtime to name.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ACTIONS = ["revert-rollout", "republish-previous", "roll-back-to-embedded"];
const CHANNELS = ["internal", "preview", "production"];
const PLATFORMS = ["android", "ios"];

export class RollbackError extends Error {}

const rolling = (group) => typeof group.rolloutPercentage === "number" && group.rolloutPercentage < 100;

/** The inputs a move needs before eas is asked anything; returns the update message. */
export function checkInputs({ action, channel, platform, reason }) {
  if (!ACTIONS.includes(action)) throw new RollbackError(`--action is one of ${ACTIONS.join(", ")}`);
  if (!CHANNELS.includes(channel)) throw new RollbackError(`--channel is one of ${CHANNELS.join(", ")}`);
  if (!PLATFORMS.includes(platform)) throw new RollbackError(`--platform is android or ios`);
  if ((reason ?? "").trim().length < 10) throw new RollbackError("--reason needs at least 10 characters: it is the update message and the audit trail");
  return `rollback: ${reason.trim()}`.slice(0, 200);
}

/** The eas-cli arguments of the move (without the signing key) and a sentence saying what it does. */
export function plan({ action, channel, platform, group, runtimeVersion, reason }, groups) {
  const message = checkInputs({ action, channel, platform, reason });
  const named = group ? groups.find((g) => g.group === group) : null;
  if (group && !named) throw new RollbackError(`group ${group} is not among the newest ${platform} updates on ${channel}`);

  if (action === "revert-rollout") {
    const target = named ?? groups.find(rolling);
    if (!target || !rolling(target)) throw new RollbackError(`no ${platform} update is rolling out on ${channel}${group ? ` as group ${group}` : ""}: use republish-previous or roll-back-to-embedded`);
    return {
      argv: ["update:revert-update-rollout", "--group", target.group, "--message", message, "--non-interactive"],
      says: `revert the ${target.rolloutPercentage} % rollout of group ${target.group} on ${channel}`,
    };
  }

  if (action === "republish-previous") {
    const bad = named ?? groups[0];
    if (!bad) throw new RollbackError(`no ${platform} update on ${channel} to roll back`);
    if (rolling(bad)) throw new RollbackError(`group ${bad.group} is still rolling out (${bad.rolloutPercentage} %): use revert-rollout`);
    const index = groups.indexOf(bad);
    const newer = groups.slice(0, index).find((g) => g.runtimeVersion === bad.runtimeVersion);
    if (newer) throw new RollbackError(`group ${bad.group} is already replaced by ${newer.group} on its runtime: name that group instead`);
    const previous = groups.slice(index + 1).find((g) => g.runtimeVersion === bad.runtimeVersion && !g.isRollBackToEmbedded);
    if (!previous) throw new RollbackError(`no earlier ${platform} update for runtime ${bad.runtimeVersion} on ${channel}: use roll-back-to-embedded`);
    return {
      argv: ["update:republish", "--group", previous.group, "--platform", platform, "--message", message, "--non-interactive"],
      says: `publish group ${previous.group} again on ${channel}, over ${bad.group} (runtime ${bad.runtimeVersion})`,
    };
  }

  const runtime = runtimeVersion || named?.runtimeVersion || groups[0]?.runtimeVersion;
  if (!runtime) throw new RollbackError(`no runtime to roll back on ${channel}: pass --runtime-version (the store build's fingerprint)`);
  return {
    argv: ["update:roll-back-to-embedded", "--branch", channel, "--runtime-version", runtime, "--platform", platform, "--message", message, "--non-interactive"],
    says: `send ${platform} phones of runtime ${runtime} on ${channel} back to the bundle in their binary`,
  };
}

function parseArgs(argv) {
  const options = { dryRun: false };
  const names = { "--action": "action", "--channel": "channel", "--platform": "platform", "--group": "group", "--runtime-version": "runtimeVersion", "--reason": "reason" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") options.dryRun = true;
    else if (names[argv[i]] && argv[i + 1] !== undefined) options[names[argv[i]]] = argv[++i];
    else throw new RollbackError(`unknown argument ${argv[i]}`);
  }
  return options;
}

export async function main(argv, { env = process.env, eas, log = console.log, summary = (text) => env.GITHUB_STEP_SUMMARY && fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text) } = {}) {
  const options = parseArgs(argv);
  checkInputs(options);
  if (!options.dryRun && !env.EAS_UPDATE_PRIVATE_KEY_PATH) throw new RollbackError("EAS_UPDATE_PRIVATE_KEY_PATH is not set: a rollback is an update, and phones refuse an unsigned one");
  const listed = JSON.parse(eas(["update:list", "--branch", options.channel, "--platform", options.platform, "--limit", "50", "--json", "--non-interactive"]));
  const { argv: args, says } = plan(options, listed.currentPage ?? []);
  const signed = env.EAS_UPDATE_PRIVATE_KEY_PATH ? [...args, "--private-key-path", env.EAS_UPDATE_PRIVATE_KEY_PATH] : args;
  const head = `### UniChat OTA rollback (${options.action}, ${options.channel}, ${options.platform})\n\n- ${options.dryRun ? "would" : "did"}: ${says}\n- reason: ${options.reason.trim()}\n- eas ${args.join(" ")}\n`;
  if (!options.dryRun) log(eas(signed));
  summary(head);
  log(head);
  return { argv: signed, says };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cwd = path.resolve(import.meta.dirname, "../apps/chat-mobile");
  const eas = (args) => execFileSync("eas", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  main(process.argv.slice(2), { eas }).catch((error) => {
    console.log(`::error::${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
