#!/usr/bin/env node
// Canaries for UniChat mobile's CI gates (audit P1 "gates-never-ran"): a gate
// counts once it has been seen red on a deliberately broken commit, not when
// its YAML exists. Each canary breaks one thing of a class PR #387 met (or one
// a gate added since is meant to catch) and names the mobile-verify jobs that
// must turn red. Run one on a throwaway branch, push it, open a draft PR (or
// dispatch mobile-verify on it), check the jobs, then delete the branch:
//
//   node scripts/mobile-canary.mjs --list
//   git switch -c canary/boot-crash && node scripts/mobile-canary.mjs boot-crash && git commit -am "test: canary boot-crash"
//
// Never merge a canary branch. Runbook › Canary runs records what each proved.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

/** Each canary: the file it edits, the text it replaces (exactly once) and with what, and the jobs that must go red. */
export const CANARIES = {
  "missing-peer": {
    what: "a native peer the Expo SDK needs is no longer declared (PR #387: expo-asset)",
    file: "apps/chat-mobile/package.json",
    find: '    "expo-asset": "~57.0.20",\n',
    replace: "",
    // Without it the frozen-lockfile install fails first, and the canary proves nothing about the gate.
    after: "pnpm install --lockfile-only",
    red: ["mobile (expo install --check, knip)", "expo-doctor and JS bundle budget"],
  },
  "babel-plugin": {
    what: "the JSX transform the css-interop preset calls by name is gone (PR #387)",
    file: "apps/chat-mobile/package.json",
    find: '    "@babel/plugin-transform-react-jsx": "^7.29.7",\n',
    replace: "",
    after: "pnpm install --lockfile-only",
    red: ["expo-doctor and JS bundle budget (expo export)", "Android release build"],
  },
  "ios-only-locale": {
    what: "the iOS usage strings reach Android's resources (PR #387: lintVitalRelease)",
    file: "apps/chat-mobile/app.config.ts",
    find: "locales: { en: { ios: USAGE_EN } },",
    replace: "locales: { en: USAGE_EN },",
    red: ["mobile (app.config.test.ts)", "Android release build (lintVitalRelease)"],
  },
  "boot-crash": {
    what: "the app throws as it starts",
    file: "apps/chat-mobile/index.ts",
    find: 'import "expo-router/entry";\n',
    replace: 'import "expo-router/entry";\n\nif (Date.now() > 0) throw new Error("canary: crash on boot");\n',
    red: ["Android cold-start smoke", "iOS simulator release build (smoke)"],
  },
  "kotlin-parse": {
    what: 'a KDoc says "/*", which opens a nested comment the file never closes',
    file: "apps/chat-mobile/modules/unichat-calls/android/src/main/java/expo/modules/unichatcalls/UniChatCallsModule.kt",
    find: " * data/calls/, which tests it with this module mocked.",
    replace: " * data/calls/*, which tests it with this module mocked.",
    red: ["mobile (ktlint)", "Android release build"],
  },
  "launch-token": {
    what: "any launch vouches for any ringing call",
    file: "apps/chat-mobile/modules/unichat-calls/android/src/main/java/expo/modules/unichatcalls/CallLaunchTokens.kt",
    find: "return if (MessageDigest.isEqual(presented.toByteArray(), expected.toByteArray())) callId else null",
    replace: "return callId",
    red: ["Android release build (:unichat-calls:testReleaseUnitTest)"],
  },
  "scope-crash": {
    what: "the scope job crashes, which skips every check after it",
    file: "scripts/mobile-native-scope.mjs",
    find: 'if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {\n',
    replace: 'if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {\n  throw new Error("canary: scope crash");\n',
    red: ["UniChat mobile gate (scope failed, the rest skipped)"],
  },
  "foreign-lockfile": {
    what: "an npm lockfile in the app makes EAS install with npm (PR #387)",
    file: "apps/chat-mobile/package-lock.json",
    create: '{ "lockfileVersion": 3 }\n',
    red: ["mobile (scripts/mobile-lockfiles.test.mjs)"],
  },
  "easignore-drift": {
    what: "a .gitignore pattern EAS does not know about",
    file: ".gitignore",
    find: "*.pid\n",
    replace: "*.pid\ncanary-secret.key\n",
    red: ["mobile (scripts/mobile-easignore.test.mjs)"],
  },
};

/** Why a canary no longer applies to the tree (its anchor moved), or null. */
export function staleness(name, read = (file) => fs.readFileSync(path.join(root, file), "utf8"), exists = (file) => fs.existsSync(path.join(root, file))) {
  const canary = CANARIES[name];
  if (canary.create !== undefined) return exists(canary.file) ? `${canary.file} already exists` : null;
  if (!exists(canary.file)) return `${canary.file} is gone`;
  const count = read(canary.file).split(canary.find).length - 1;
  return count === 1 ? null : `${canary.file} holds its anchor ${count} times, not once`;
}

function apply(name) {
  const canary = CANARIES[name];
  const stale = staleness(name);
  if (stale) throw new Error(`canary ${name} no longer applies: ${stale}`);
  const file = path.join(root, canary.file);
  if (canary.create !== undefined) fs.writeFileSync(file, canary.create);
  else fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(canary.find, canary.replace));
  console.log(`canary ${name}: ${canary.what}\nexpect red: ${canary.red.join("; ")}`);
  if (canary.after) console.log(`now run: ${canary.after}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    for (const [name, c] of Object.entries(CANARIES)) console.log(`${name.padEnd(18)} ${c.what}\n${" ".repeat(19)}red: ${c.red.join("; ")}`);
  } else if (arg in CANARIES) {
    apply(arg);
  } else {
    console.error(`unknown canary ${arg}; --list shows them`);
    process.exit(2);
  }
}
