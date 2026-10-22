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

// Nothing on a developer machine compiles Kotlin, so a comment that ends early (a `*/` written inside the text,
// as in a `values*/` path) or never ends (Kotlin nests block comments, so a `/*` inside one opens another)
// would first fail on EAS. This lexer is deliberately small: strings, char literals, line and block comments.
const kotlinCommentFaults = (source: string): string[] => {
  const faults: string[] = [];
  const lineOf = (index: number): number => source.slice(0, index).split("\n").length;
  const lineEnd = (index: number): number => {
    const end = source.indexOf("\n", index);
    return end < 0 ? source.length : end;
  };
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      i = lineEnd(i);
    } else if (pair === "/*") {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) {
        faults.push(`${lineOf(i)}: block comment never closes`);
        break;
      }
      const body = source.slice(i + 2, close);
      const nested = body.indexOf("/*");
      if (nested >= 0) faults.push(`${lineOf(i + 2 + nested)}: "/*" inside a comment opens a nested one in Kotlin`);
      const rest = source.slice(close + 2, lineEnd(close));
      if (body.includes("\n") && rest.trim() !== "") faults.push(`${lineOf(close)}: "*/" ends the comment mid-line`);
      i = close + 2;
    } else if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      i = end < 0 ? source.length : end + 3;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"' && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else if (source[i] === "'") {
      const literal = /^'(\\u[0-9a-fA-F]{4}|\\.|[^'\\\n])'/.exec(source.slice(i));
      i += literal ? literal[0].length : 1;
    } else if (pair === "*/") {
      faults.push(`${lineOf(i)}: stray "*/" outside a comment`);
      i += 2;
    } else {
      i += 1;
    }
  }
  return faults;
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

  it("the Kotlin comment check finds a comment that a path closes early", () => {
    const early = "/**\n * Read from res/values*/strings.xml, which the app's copy fills.\n */\nclass A\n";
    expect(kotlinCommentFaults(early)).toEqual([
      '2: "*/" ends the comment mid-line',
      '3: stray "*/" outside a comment',
    ]);
    expect(kotlinCommentFaults("/* res/values-*/\nclass A")).toEqual([]);
    expect(kotlinCommentFaults("/**\n * see /* here\n */\n")).toEqual(['2: "/*" inside a comment opens a nested one in Kotlin']);
    expect(kotlinCommentFaults("/* open\n")).toEqual(["1: block comment never closes"]);
    expect(kotlinCommentFaults('val a = "*/"\nval b = \'*\'\nval c = """/* */"""\n// a */ note\n/** x */ fun f() = 1\n')).toEqual([]);
  });

  it.each(localModules)("$name: every Kotlin comment closes where it is written", ({ dir }) => {
    const sources = tracked(dir).filter((file) => file.endsWith(".kt"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect({ file, faults: kotlinCommentFaults(readFileSync(path.join(dir, file), "utf8")) }).toEqual({ file, faults: [] });
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

// The calls module compiles against expo-notifications' FCM service as a Gradle project. SDK 57
// links that package as a prebuilt AAR by default, which leaves no ':expo-notifications' project
// and fails the release build, so the app asks autolinking to build it from source.
describe("native build wiring", () => {
  const read = (file: string) => readFileSync(path.join(appRoot, file), "utf8");

  it("builds expo-notifications from source while the calls module depends on its project", () => {
    const gradle = read("modules/unichat-calls/android/build.gradle");
    const pkg = JSON.parse(read("package.json")) as { expo?: { autolinking?: { android?: { buildFromSource?: string[] } } } };
    expect(gradle).toContain("project(':expo-notifications')");
    expect(pkg.expo?.autolinking?.android?.buildFromSource).toContain("expo-notifications");
  });
});
