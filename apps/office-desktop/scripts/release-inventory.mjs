import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, cp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import process from "node:process";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const repositoryRoot = resolve(appDirectory, "../..");
const upstreamDirectory = join(repositoryRoot, "packages", "office-upstream");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function insideRepository(file) {
  const root = `${repositoryRoot}${sep}`;
  return file === repositoryRoot || file.startsWith(root);
}

async function digestFile(file) {
  return sha256(await readFile(file));
}

async function listFiles(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result.push(file);
    }
  }
  await visit(directory);
  return result.sort();
}

function packageJsonForPath(candidate) {
  let current = resolve(candidate);
  while (insideRepository(current)) {
    const packageJson = join(current, "package.json");
    try { return { directory: current, metadata: JSON.parse(readFileSync(packageJson, "utf8")) }; } catch { /* continue toward the repository root */ }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function shippedPackageNames(metafile) {
  const names = new Set();
  for (const input of Object.keys(metafile?.inputs ?? {})) {
    const packageInfo = packageJsonForPath(resolve(appDirectory, input));
    if (typeof packageInfo?.metadata?.name === "string") names.add(packageInfo.metadata.name);
  }
  return names;
}

function licenseTextFor(packageDirectory, privateWorkspace) {
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "NOTICE", "NOTICE.md", "NOTICE.txt"]) {
    try { return readFileSync(join(packageDirectory, file), "utf8").trim(); } catch { /* try the next conventional name */ }
  }
  if (privateWorkspace) return "Internal UniWork workspace package; no third-party licence text is redistributed.";
  return "";
}

function dependencyRowsFromPnpm({ metafile } = {}) {
  const pnpmCommand = process.env.PNPM_BIN ?? "pnpm";
  // Depth 10 captures the complete practical graph for this package while
  // keeping pnpm's JSON bounded on a monorepo with many workspace peers.
  const runList = (extraArguments) => {
    const pnpmArguments = ["list", "--json", "--depth", "10", "--filter", "@uniwork/office-desktop", ...extraArguments];
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : pnpmCommand;
    const argumentsForProcess = process.platform === "win32" ? ["/d", "/s", "/c", `${pnpmCommand} ${pnpmArguments.join(" ")}`] : pnpmArguments;
    const result = spawnSync(command, argumentsForProcess, {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env },
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0 || !String(result.stdout ?? "").trim()) throw new Error(`pnpm list failed (status=${String(result.status)}): ${String(result.stderr ?? result.error?.message ?? "no dependency tree").trim() || "no dependency tree"}`);
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  // Traverse production dependencies only. Dev-only test, lint and build
  // tooling is not shipped because the host code is bundled by esbuild.
  const roots = runList([]);
  const shipped = shippedPackageNames(metafile);
  const rows = new Map();
  const visit = (node, fallbackName) => {
    if (!node || typeof node !== "object") return;
    const name = typeof node.name === "string" ? node.name : fallbackName;
    if (typeof name === "string" && typeof node.version === "string") {
      if (name === "@uniwork/office-desktop") {
        // The application itself is not a third-party dependency; still walk
        // its production graph below.
      } else {
      const packageInfo = typeof node.path === "string" && insideRepository(resolve(node.path)) ? packageJsonForPath(node.path) : undefined;
      const packageJson = packageInfo ? join(packageInfo.directory, "package.json") : undefined;
      let license = "UNKNOWN";
      let privateWorkspace = false;
      if (packageJson) {
        try {
          const metadata = JSON.parse(readFileSync(packageJson, "utf8"));
          license = typeof metadata.license === "string" ? metadata.license : Array.isArray(metadata.licenses) ? metadata.licenses.map((item) => item.type ?? item).join(" OR ") : "UNKNOWN";
          privateWorkspace = metadata.private === true && name.startsWith("@uniwork/");
          if (privateWorkspace) license = "UNLICENSED (internal workspace)";
        } catch {
          license = "UNKNOWN";
        }
      }
      if (shipped.size > 0 && !shipped.has(name) && !name.startsWith("@uniwork/")) return;
      rows.set(`${name}@${node.version}`, { name, version: node.version, license, licenseText: packageInfo ? licenseTextFor(packageInfo.directory, privateWorkspace) : "", privateWorkspace });
      }
    }
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [childName, child] of Object.entries(node[key] ?? {})) visit(child, childName);
    }
  };
  for (const root of roots) visit(root);
  // Electron is embedded by electron-builder even though it is not an esbuild
  // input, so include its licence in the redistributed notices.
  const electronPackage = packageJsonForPath(dirname(require.resolve("electron/package.json")));
  if (electronPackage?.metadata?.name && electronPackage.metadata.version) {
    const key = `${electronPackage.metadata.name}@${electronPackage.metadata.version}`;
    rows.set(key, { name: electronPackage.metadata.name, version: electronPackage.metadata.version, license: electronPackage.metadata.license ?? "UNKNOWN", licenseText: licenseTextFor(electronPackage.directory, false), privateWorkspace: false });
  }
  return [...rows.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

async function collectFontRows() {
  const fixtureManifest = JSON.parse(await readFile(join(repositoryRoot, "docs", "office", "g0", "fixtures", "manifest.json"), "utf8"));
  const rows = [];
  for (const fixture of fixtureManifest.fixtures ?? []) {
    const notice = fixture.source?.thirdPartyNotice;
    if (!notice || !fixture.license) continue;
    const noticePath = resolve(repositoryRoot, notice);
    if (!insideRepository(noticePath)) throw new Error(`font notice escaped repository: ${notice}`);
    rows.push({ fixture: fixture.id, license: fixture.license, notice: relative(repositoryRoot, noticePath).replaceAll("\\", "/"), sourceFontSha256: fixture.source?.sourceFontSha256 ?? null, licenseSha256: fixture.source?.licenseSha256 ?? null });
  }
  return rows.sort((a, b) => a.fixture.localeCompare(b.fixture));
}

async function scanEe() {
  const matches = [];
  for (const file of await listFiles(repositoryRoot)) {
    if (file.includes(`${sep}.git${sep}`) || file.includes(`${sep}node_modules${sep}`) || file.includes(`${sep}dist${sep}`)) continue;
    const parts = file.split(/[\\/]/);
    if (parts.includes("ee")) matches.push(relative(repositoryRoot, file).replaceAll("\\", "/"));
  }
  return matches;
}

export async function generateReleaseInventory({ outputDirectory = join(appDirectory, "dist", "release-inventory"), metafile } = {}) {
  const output = resolve(outputDirectory);
  if (!insideRepository(output)) throw new Error("inventory output must stay inside the checkout");
  const provenancePath = join(upstreamDirectory, "provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  const patchesDirectory = join(upstreamDirectory, "patches");
  const patchFiles = (await listFiles(patchesDirectory)).filter((file) => file.endsWith(".patch"));
  const patchDigests = [];
  for (const file of patchFiles) patchDigests.push({ file: relative(repositoryRoot, file).replaceAll("\\", "/"), sha256: await digestFile(file) });
  const eeMatches = await scanEe();
  if (eeMatches.length > 0) throw new Error(`ee/ material is not allowed in the desktop inventory: ${eeMatches.join(", ")}`);
  const dependencies = dependencyRowsFromPnpm({ metafile });
  const unknown = dependencies.filter((dependency) => dependency.license === "UNKNOWN" && !dependency.privateWorkspace);
  if (unknown.length > 0) throw new Error(`shipped dependency licence metadata is unknown: ${unknown.map((dependency) => `${dependency.name}@${dependency.version}`).join(", ")}`);
  const fontRedistribution = await collectFontRows();
  await mkdir(output, { recursive: true });
  await cp(join(upstreamDirectory, "LICENSE"), join(output, "LICENSE"));
  await cp(join(upstreamDirectory, "NOTICE"), join(output, "NOTICE"));
  const inventory = {
    schemaVersion: 1,
    generatedBy: "apps/office-desktop/scripts/release-inventory.mjs",
    source: {
      package: "packages/office-upstream",
      pinnedCommit: provenance.upstream?.pinnedCommit,
      pinnedTree: provenance.upstream?.pinnedTree,
      filesDigest: provenance.integrity?.filesDigest,
      license: provenance.upstream?.licenseIdentifier,
      licenseHolder: provenance.upstream?.licenseHolder,
    },
    patches: patchDigests,
    dependencies,
    fontRedistribution,
    eeScan: { clean: true, matches: eeMatches },
  };
  await writeFile(join(output, "source-and-patches.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  const notices = ["UniWork Office third-party notices", "Generated from the resolved production dependency tree and embedded Electron runtime.", "", ...dependencies.flatMap((row) => [`${row.name}@${row.version} - ${row.license}`, row.licenseText || "(No licence text file was published by this package.)", ""])];
  await writeFile(join(output, "THIRD-PARTY-NOTICES.txt"), `${notices.join("\n")}\n`);
  await writeFile(join(output, "EE-SCAN.json"), `${JSON.stringify(inventory.eeScan, null, 2)}\n`);
  return { outputDirectory: output, inventory, files: ["LICENSE", "NOTICE", "source-and-patches.json", "THIRD-PARTY-NOTICES.txt", "EE-SCAN.json"] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateReleaseInventory();
  process.stdout.write(`office-desktop: release inventory generated at ${result.outputDirectory}\n`);
}
