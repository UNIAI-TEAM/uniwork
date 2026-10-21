// The app's own Expo modules (modules/*) build only from what git holds: CI
// and EAS check out the repository, so a native folder that exists on one
// machine but is ignored or uncommitted builds an app whose module is
// silently missing (expo-modules-autolinking skips a module with no
// build.gradle). And autolinking registers an expo `Package` only from a file
// named *Package.kt, taking the class from the file's name, so a Package
// declared anywhere else never runs.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = __dirname;
const modulesRoot = path.join(appRoot, "modules");

const tracked = (dir: string): string[] =>
  execFileSync("git", ["ls-files", "--", dir], { cwd: appRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((file) => path.relative(dir, path.join(appRoot, file)));

const ignored = (file: string): boolean => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", file], { cwd: appRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

interface ModuleConfig {
  platforms: string[];
  android?: { modules?: string[] };
}

const localModules = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const dir = path.join(modulesRoot, entry.name);
    const config = JSON.parse(readFileSync(path.join(dir, "expo-module.config.json"), "utf8")) as ModuleConfig;
    return { name: entry.name, dir, config };
  });

const classFile = (classifier: string): string => {
  const parts = classifier.split(".");
  return path.join("android/src/main/java", ...parts.slice(0, -1), `${parts.at(-1)}.kt`);
};

describe("the app's local Expo modules", () => {
  it("has at least the calls module", () => {
    expect(localModules.map((module) => module.name)).toContain("unichat-calls");
  });

  it.each(localModules)("$name: git holds the native project of every platform it declares", ({ dir, config }) => {
    const files = tracked(dir);
    for (const platform of config.platforms) {
      if (platform !== "android") throw new Error(`no guard for platform ${platform}: add one here`);
      expect(files).toContain("android/build.gradle");
      expect(files).toContain("android/src/main/AndroidManifest.xml");
      for (const classifier of config.android?.modules ?? []) expect(files).toContain(classFile(classifier));
      // Nothing under the native folder may be ignored: a new file there would be left behind.
      expect(ignored(path.join(dir, "android/src/main/java/Probe.kt"))).toBe(false);
    }
  });

  it.each(localModules)("$name: every Package lives in a file named after it", ({ dir }) => {
    const sources = tracked(dir).filter((file) => file.endsWith(".kt"));
    for (const file of sources) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/class\s+(\w+)\s*:\s*Package\b/g)) {
        expect(path.basename(file)).toBe(`${match[1]}.kt`);
        expect(match[1]).toMatch(/Package$/);
      }
    }
  });

  it("autolinking registers the calls module and its lock-screen Package", { timeout: 60_000 }, () => {
    const out = execFileSync("npx", ["expo-modules-autolinking", "resolve", "-p", "android", "--json"], {
      cwd: appRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = JSON.parse(out) as {
      modules: { packageName: string; projects: { modules: { classifier: string }[]; packages: string[] }[] }[];
    };
    const calls = resolved.modules.find((module) => module.packageName === "unichat-calls");
    expect(calls?.projects).toHaveLength(1);
    expect(calls?.projects[0]?.modules.map((module) => module.classifier)).toEqual(["expo.modules.unichatcalls.UniChatCallsModule"]);
    expect(calls?.projects[0]?.packages).toEqual(["expo.modules.unichatcalls.UniChatCallsPackage"]);
  });
});
