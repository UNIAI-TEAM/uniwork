import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Deprecated lucide-react export names, read from the installed package's own
 * type declarations. Lucide keeps a renamed icon importable under its old name
 * (`AlertCircle` for `CircleAlert`, `Loader2` for `LoaderCircle`); the export
 * list spells each one as `Canonical as Alias`. An alias is deprecated unless
 * it is the canonical name with the `Icon` suffix (the shadcn convention
 * packages/ui keeps) or the `Lucide` prefix.
 *
 * Returns `{ alias: canonical }`, sorted by alias.
 */
export function lucideDeprecatedAliases(root = process.cwd()) {
  const require = createRequire(path.join(root, "packages", "ui", "package.json"));
  let dir = path.dirname(require.resolve("lucide-react"));
  while (!dir.endsWith(`${path.sep}lucide-react`)) dir = path.dirname(dir);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const types = pkg.types ?? pkg.typings;
  const dts = readFileSync(path.join(dir, types), "utf8");
  const exportLine = dts.split("\n").find((line) => line.startsWith("export {") && line.includes(" as "));
  if (!exportLine) throw new Error(`no export list in ${types}`);

  const canonical = new Set();
  const renamed = [];
  for (const spec of exportLine.slice(exportLine.indexOf("{") + 1, exportLine.lastIndexOf("}")).split(",")) {
    const m = spec.trim().match(/^(\w+)(?: as (\w+))?$/);
    if (!m) continue;
    if (m[2]) renamed.push([m[2], m[1]]);
    else canonical.add(m[1]);
  }
  const aliases = renamed
    .filter(([alias, name]) => alias !== `${name}Icon` && alias !== `Lucide${name}` && !canonical.has(alias))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(aliases);
}

/** The name to import instead of `alias`, keeping its `Icon` suffix or `Lucide` prefix. */
export function canonicalFor(alias, canonical) {
  if (alias.startsWith("Lucide")) return `Lucide${canonical}`;
  if (alias.endsWith("Icon")) return `${canonical}Icon`;
  return canonical;
}
