// The licenses screen's data: the generated file is current (a dependency
// change regenerates it) and names every direct dependency, and the helpers
// read, search and link it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterLicenses, licenseEntries, npmPackageUrl } from "./licenses";

const appRoot = path.resolve(__dirname, "..");
const rows: unknown = JSON.parse(fs.readFileSync(path.join(appRoot, "assets/licenses.json"), "utf8"));

describe("assets/licenses.json", () => {
  it("is what generate-licenses.mjs writes from the installed dependencies", () => {
    expect(() => execFileSync(process.execPath, [path.join(appRoot, "scripts/generate-licenses.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("lists every third-party dependency of the app, with a license", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const names = new Set(licenseEntries(rows).map((entry) => entry.name));
    const direct = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@uniwork/"));
    expect(direct.filter((name) => !names.has(name))).toEqual([]);
    expect(licenseEntries(rows).filter((entry) => direct.includes(entry.name) && !entry.license)).toEqual([]);
  });
});

describe("licenseEntries", () => {
  it("reads [name, version, license] rows and skips anything else", () => {
    expect(licenseEntries([["react", "19.2.3", "MIT"], ["@scope/pkg", "1.0.0", ""], ["x"], [1, 2, 3], ["", "1", "MIT"], "row"])).toEqual([
      { name: "react", version: "19.2.3", license: "MIT", url: "https://www.npmjs.com/package/react/v/19.2.3" },
      { name: "@scope/pkg", version: "1.0.0", license: "", url: "https://www.npmjs.com/package/%40scope/pkg/v/1.0.0" },
    ]);
    expect(licenseEntries({ not: "rows" })).toEqual([]);
  });
});

describe("filterLicenses", () => {
  const entries = licenseEntries([
    ["react", "19.2.3", "MIT"],
    ["livekit-client", "2.21.0", "Apache-2.0"],
  ]);

  it("matches a name or a license, any case; an empty query keeps all", () => {
    expect(filterLicenses(entries, "LIVE").map((e) => e.name)).toEqual(["livekit-client"]);
    expect(filterLicenses(entries, "mit").map((e) => e.name)).toEqual(["react"]);
    expect(filterLicenses(entries, "  ")).toHaveLength(2);
    expect(filterLicenses(entries, "vue")).toEqual([]);
  });

  it("links a scoped package to its npm page", () => {
    expect(npmPackageUrl("@sentry/react-native", "7.11.0")).toBe("https://www.npmjs.com/package/%40sentry/react-native/v/7.11.0");
  });
});
