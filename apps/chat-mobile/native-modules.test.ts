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
  apple?: { modules?: string[]; appDelegateSubscribers?: string[] };
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
  it("has at least the calls module and the background-send module", () => {
    expect(localModules.map((module) => module.name)).toEqual(expect.arrayContaining(["unichat-calls", "unichat-background"]));
  });

  it.each(localModules)("$name: git holds the native project of every platform it declares", ({ dir, config }) => {
    const files = tracked(dir);
    for (const platform of config.platforms) {
      if (platform === "android") {
        expect(files).toContain("android/build.gradle");
        expect(files).toContain("android/src/main/AndroidManifest.xml");
        for (const classifier of config.android?.modules ?? []) expect(files).toContain(classFile(classifier));
        // Nothing under the native folder may be ignored: a new file there would be left behind.
        expect(ignored(path.join(dir, "android/src/main/java/Probe.kt"))).toBe(false);
      } else if (platform === "apple" || platform === "ios") {
        // CocoaPods links a local module through its podspec (autolinking finds it under ios/); without one the
        // module is skipped as silently as an Android module without build.gradle. "ios" and "apple" link the same
        // way (expo-modules-autolinking › supportsPlatform), and both read the `apple` block.
        expect(files.filter((file) => /^ios\/[^/]+\.podspec$/.test(file))).toHaveLength(1);
        expect(config.apple?.modules?.length).toBeGreaterThan(0);
        // Each class the generated ExpoModulesProvider names lives in a file named after it.
        const classes = [...(config.apple?.modules ?? []), ...(config.apple?.appDelegateSubscribers ?? [])];
        for (const name of classes) expect(files).toContain(`ios/${name}.swift`);
        expect(ignored(path.join(dir, "ios/Probe.swift"))).toBe(false);
      } else {
        throw new Error(`no guard for platform ${platform}: add one here`);
      }
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

  it("autolinking registers the background-send module on both platforms", { timeout: 60_000 }, () => {
    const resolve = (platform: string) =>
      JSON.parse(
        execFileSync("npx", ["expo-modules-autolinking", "resolve", "-p", platform, "--json"], {
          cwd: appRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ) as { modules: { packageName: string; projects?: { modules: { classifier: string }[] }[]; pods?: { podName: string }[]; modules?: unknown }[] };
    const android = resolve("android").modules.find((module) => module.packageName === "unichat-background");
    expect(android?.projects?.[0]?.modules.map((module) => module.classifier)).toEqual(["expo.modules.unichatbackground.UniChatBackgroundModule"]);
    const apple = resolve("apple").modules.find((module) => module.packageName === "unichat-background");
    expect(apple?.pods?.map((pod) => pod.podName)).toEqual(["UniChatBackground"]);
  });

  // docs/adr/0038: the iOS half is its own native module ("UniChatCallKit"), so the Android-shaped "UniChatCalls" stays
  // null on iPhone and data/calls/native-calls.ts never calls a Kotlin function there; the launch subscriber creates
  // the PushKit registry before a closed app's VoIP push is handed over.
  it("autolinking registers the calls module's iOS half and its launch subscriber", { timeout: 60_000 }, () => {
    const out = execFileSync("npx", ["expo-modules-autolinking", "resolve", "-p", "apple", "--json"], {
      cwd: appRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = JSON.parse(out) as {
      modules: { packageName: string; pods: { podName: string }[]; modules: { class: string }[]; appDelegateSubscribers: string[] }[];
    };
    const calls = resolved.modules.find((module) => module.packageName === "unichat-calls");
    expect(calls?.pods.map((pod) => pod.podName)).toEqual(["UniChatCalls"]);
    expect(calls?.modules.map((module) => module.class)).toEqual(["UniChatCallKitModule"]);
    expect(calls?.appDelegateSubscribers).toEqual(["UniChatCallsAppDelegateSubscriber"]);
    const swift = readFileSync(path.join(modulesRoot, "unichat-calls/ios/UniChatCallKitModule.swift"), "utf8");
    expect(swift).toContain('Name("UniChatCallKit")');
    expect(readFileSync(path.join(modulesRoot, "unichat-calls/index.ts"), "utf8")).toContain('requireOptionalNativeModule<UniChatCallKitModule>("UniChatCallKit")');
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

  // ExpoModulesCore registers every linked module before the bundle runs, one after another; on the CI
  // simulator @expo/ui alone (about 70 SwiftUI views) cost 1.4-1.8 s of that, for modules the iOS app
  // never calls. A platform-level exclude replaces a top-level one, and Android needs @expo/ui (the
  // expo-router toolbar), so the list lives under `ios` only and names nothing the iOS bundle holds.
  describe("iOS autolinking exclusions", () => {
    interface Autolinking {
      exclude?: string[];
      android?: { exclude?: string[] };
      ios?: { exclude?: string[] };
    }
    const autolinking = (JSON.parse(read("package.json")) as { expo?: { autolinking?: Autolinking } }).expo?.autolinking;
    const iosExclude = autolinking?.ios?.exclude ?? [];

    it("excludes on iOS only, never at the top level or on Android", () => {
      expect(autolinking?.exclude).toBeUndefined();
      expect(autolinking?.android?.exclude).toBeUndefined();
      expect(iosExclude).toEqual(expect.arrayContaining(["@expo/ui", "@expo/dom-webview", "expo-symbols"]));
    });

    // A sanity check of the committed baseline only: it moves when someone commits it, not with the code.
    // The gate is the export each PR produces, which scripts/mobile-bundle-composition.mjs fails when it
    // bundles an excluded package (mobile-verify › doctor-bundle › Bundle composition).
    it("the committed iOS bundle baseline holds no excluded package", () => {
      const composition = JSON.parse(read("bundle-composition.json")) as { ios: { name: string }[] };
      const bundled = composition.ios.map((entry) => entry.name);
      expect(bundled.length).toBeGreaterThan(0);
      expect(iosExclude.filter((name) => bundled.includes(name))).toEqual([]);
    });

    it("autolinking for apple drops the excluded modules and keeps the router's", { timeout: 60_000 }, () => {
      const out = execFileSync("npx", ["expo-modules-autolinking", "resolve", "-p", "apple", "--json"], {
        cwd: appRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const linked = (JSON.parse(out) as { modules: { packageName: string }[] }).modules.map((module) => module.packageName);
      expect(linked.filter((name) => iosExclude.includes(name))).toEqual([]);
      expect(linked).toEqual(expect.arrayContaining(["expo-router", "expo-glass-effect"]));
    });
  });
});

// lintVitalRelease cannot see that UniChatMessagingService is a Service (firebase-messaging is only
// expo-notifications' implementation dependency) and failed the first EAS release build on it.
describe("calls plugin manifest", () => {
  it("declares iOS's voip and audio modes exactly in a build with calls, and never fetch", async () => {
    const plugin = (await import("./plugins/with-unichat-calls.js")) as unknown as {
      iosBackgroundModes: (modes: unknown, iosCalls: boolean) => string[] | undefined;
    };
    expect(plugin.iosBackgroundModes(["audio", "fetch", "processing", "voip"], false)).toEqual(["processing"]);
    expect(plugin.iosBackgroundModes(["fetch", "processing", "audio"], true)).toEqual(["processing", "audio", "voip"]);
    expect(plugin.iosBackgroundModes(undefined, true)).toEqual(["audio", "voip"]);
    expect(plugin.iosBackgroundModes(["fetch", "audio", 3], false)).toBeUndefined();
    expect(plugin.iosBackgroundModes("audio", false)).toBeUndefined();
  });

  it("tells lint the messaging service is instantiable, with the tools namespace it needs", async () => {
    // The plugin is CommonJS: MESSAGING_SERVICE hangs off module.exports, which the inferred type does not show.
    const plugin = (await import("./plugins/with-unichat-calls.js")) as unknown as { MESSAGING_SERVICE: { $: Record<string, string> } };
    expect(plugin.MESSAGING_SERVICE.$["tools:ignore"]).toBe("Instantiatable");
    expect(readFileSync(path.join(appRoot, "plugins/with-unichat-calls.js"), "utf8")).toContain('"xmlns:tools": TOOLS');
  });
});

// Apple: from iOS 13 a VoIP push whose app does not report a call to CallKit before PushKit's completion runs ends the
// app, and repeated, stops VoIP delivery to it. Nothing on a developer machine runs Swift, so the shape is held here:
// the push callback hands every push (ours or not) to report(), and report() calls the completion only once CallKit
// has taken the report (or when no provider exists, which cannot happen: the registry is made after it).
describe("every VoIP push is reported to CallKit (ios/CallCenter.swift)", () => {
  const source = readFileSync(path.join(modulesRoot, "unichat-calls/ios/CallCenter.swift"), "utf8");
  const body = (signature: string): string => {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`${signature} never closes`);
  };

  it("hands every VoIP push to report()", () => {
    const callback = body("didReceiveIncomingPushWith payload: PKPushPayload");
    expect(callback).toContain("report(VoipCallPush(payload.dictionaryPayload), completion: completion)");
    // The only other completion is for a push type the registry never asked for.
    expect(callback.match(/completion\(\)/g)).toHaveLength(1);
    expect(callback).toMatch(/guard type == \.voIP else \{\s*completion\(\)/);
  });

  it("reports before it completes, whatever the push held", () => {
    const report = body("private func report(_ push: VoipCallPush?, completion:");
    const reported = report.indexOf("provider.reportNewIncomingCall(");
    expect(reported).toBeGreaterThan(0);
    const completions = [...report.matchAll(/completion\(\)/g)].map((match) => match.index);
    expect(completions).toHaveLength(2);
    expect(report.slice(0, completions[0])).toMatch(/guard let provider else \{\s*$/);
    expect(completions[1]).toBeGreaterThan(reported);
  });

  // An end reaches an iPhone whose CallKit no longer holds the call (an offline phone given only APNs' last push, a
  // race with its own ring-out): iOS still wants a report, and that report shows a new incoming call until it is
  // ended. Ended in the same turn as the report, not in its completion, the screen does not get to show it.
  it("ends a push it only reports in the same turn, not once CallKit answers the report", () => {
    const report = body("private func report(_ push: VoipCallPush?, completion:");
    const reported = report.indexOf("provider.reportNewIncomingCall(");
    const callback = report.indexOf("{ [weak self] error in", reported);
    let depth = 0;
    let closed = -1;
    for (let i = callback; i < report.length; i++) {
      if (report[i] === "{") depth++;
      if (report[i] === "}" && --depth === 0) {
        closed = i;
        break;
      }
    }
    expect(closed).toBeGreaterThan(callback);
    const after = report.slice(closed);
    expect(after).toMatch(/if case \.end\(let reason\) = outcome \{\s*provider\.reportCall\(with: id, endedAt: nil, reason: reason\)/);
  });

  it("ends a call with the reason the end push gives", () => {
    const push = readFileSync(path.join(modulesRoot, "unichat-calls/ios/VoipCallPush.swift"), "utf8");
    expect(push).toMatch(/case "answered":\s*return \.answeredElsewhere/);
    expect(push).toMatch(/case "declined":\s*return \.declinedElsewhere/);
    expect(push).toMatch(/default:\s*return \.remoteEnded/);
    expect(source).not.toMatch(/push\.kind == \.end[^\n]*\n[^\n]*\.end\(\.remoteEnded\)/);
  });
});

