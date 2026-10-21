// Settings › Privacy & legal › Open-source licenses: the rows of
// assets/licenses.json (scripts/generate-licenses.mjs) made readable, searched
// and linked to each package's npm page. Pure.
import { foldedIncludes } from "@uniwork/core/chat/search-fold";

export interface LicenseEntry {
  name: string;
  version: string;
  /** The SPDX expression the package states; "" when it states none. */
  license: string;
  url: string;
}

export function npmPackageUrl(name: string, version: string): string {
  return `https://www.npmjs.com/package/${name.split("/").map(encodeURIComponent).join("/")}/v/${encodeURIComponent(version)}`;
}

/** The generated rows; a row that is not [name, version, license] strings is skipped, never thrown on. */
export function licenseEntries(rows: unknown): LicenseEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (!Array.isArray(row) || row.length < 3 || !row.slice(0, 3).every((cell) => typeof cell === "string")) return [];
    const [name, version, license] = row as [string, string, string];
    return name && version ? [{ name, version, license, url: npmPackageUrl(name, version) }] : [];
  });
}

/** Matches the package name or its license, without regard to case or marks. */
export function filterLicenses(entries: readonly LicenseEntry[], query: string): LicenseEntry[] {
  return entries.filter((entry) => foldedIncludes(`${entry.name} ${entry.license}`, query));
}
