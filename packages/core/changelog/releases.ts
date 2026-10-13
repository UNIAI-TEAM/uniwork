import records from "./releases.json";

export interface Release {
  id: string;
  version: string;
  date: string;
  sourceRef: string;
  contentKey: string;
  sections: readonly { kind: string; items: readonly string[] }[];
}
export const CHANGELOG_RELEASES: readonly Release[] = records;

/** ISO dates keep grouping stable across browser and server time zones. */
export function groupReleasesByMonth(releases: readonly Release[]) {
  const months = new Map<string, Release[]>();
  for (const release of [...releases].sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, "en", { numeric: true }))) {
    const month = release.date.slice(0, 7);
    const items = months.get(month) ?? [];
    items.push(release);
    months.set(month, items);
  }
  return [...months].map(([month, releases]) => ({ month, releases }));
}
