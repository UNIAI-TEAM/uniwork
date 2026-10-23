import { describe, expect, it } from "vitest";
import { documentKeys } from "./keys";

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

describe("documentKeys", () => {
  it("scopes every workspace key under the workspace root", () => {
    const root = documentKeys.workspace("ws1");
    expect(root).toEqual(["documents", "ws1"]);
    const keys = [
      documentKeys.detail("ws1", "d1"),
      documentKeys.versions("ws1", "d1"),
      documentKeys.version("ws1", "d1", 3),
      documentKeys.downloadMeta("ws1", "d1"),
      documentKeys.list("ws1"),
      documentKeys.sources("ws1"),
      documentKeys.sourcesRoot("ws1"),
      documentKeys.recent("ws1"),
      documentKeys.shelved("ws1"),
      documentKeys.shelved("ws1", "f1"),
      documentKeys.sharedWithMe("ws1"),
      documentKeys.tree("ws1"),
      documentKeys.shares("ws1", "d1"),
      documentKeys.accessLogs("ws1", "d1"),
      documentKeys.adminSummary("ws1", "d1"),
      documentKeys.comments("ws1", "d1"),
    ];
    for (const key of keys) expect(startsWith(key, root)).toBe(true);
  });

  it("never lets one workspace's key equal another's", () => {
    expect(documentKeys.detail("ws1", "d1")).not.toEqual(documentKeys.detail("ws2", "d1"));
    expect(documentKeys.list("ws1")).not.toEqual(documentKeys.list("ws2"));
  });

  it("hangs per-document keys off the detail key", () => {
    const detail = documentKeys.detail("ws1", "d1");
    expect(detail).toEqual(["documents", "ws1", "doc", "d1"]);
    expect(documentKeys.versions("ws1", "d1")).toEqual([...detail, "versions"]);
    expect(documentKeys.version("ws1", "d1", 7)).toEqual([...detail, "version", 7]);
    expect(documentKeys.shares("ws1", "d1")).toEqual([...detail, "shares"]);
    expect(documentKeys.comments("ws1", "d1")).toEqual([...detail, "comments"]);
    expect(documentKeys.mentionCandidates("ws1", "d1")).toEqual([
      ...detail,
      "mention-candidates",
      "",
      null,
    ]);
  });

  it("keeps the mention picker's term and page size apart in the key", () => {
    expect(documentKeys.mentionCandidates("ws1", "d1", "an", 10)).not.toEqual(
      documentKeys.mentionCandidates("ws1", "d1", "an"),
    );
    expect(documentKeys.mentionCandidates("ws1", "d1", "an", 10)).not.toEqual(
      documentKeys.mentionCandidates("ws1", "d1", "an", 20),
    );
    expect(documentKeys.mentionCandidates("ws1", "d1", "an")).not.toEqual(
      documentKeys.mentionCandidates("ws1", "d1", "hang"),
    );
  });

  it("defaults the optional segments so a bare list or tree has a stable key", () => {
    expect(documentKeys.list("ws1")).toEqual(["documents", "ws1", "list", ""]);
    expect(documentKeys.list("ws1", "folder:f1")).toEqual(["documents", "ws1", "list", "folder:f1"]);
    expect(documentKeys.tree("ws1")).toEqual(["documents", "ws1", "tree", ""]);
    expect(documentKeys.tree("ws1", "root1")).toEqual(["documents", "ws1", "tree", "root1"]);
    expect(documentKeys.accessLogs("ws1", "d1")).toEqual([...documentKeys.detail("ws1", "d1"), "access-logs", ""]);
    expect(documentKeys.accessLogs("ws1", "d1", "download")).toEqual([...documentKeys.detail("ws1", "d1"), "access-logs", "download"]);
  });

  it("hangs the admin summary off the detail key, so a detail invalidation refreshes it", () => {
    expect(documentKeys.adminSummary("ws1", "d1")).toEqual([
      ...documentKeys.detail("ws1", "d1"),
      "admin-summary",
    ]);
  });

  it("keeps the download key per version, with 0 meaning the current one", () => {
    expect(documentKeys.downloadMeta("ws1", "d1")).toEqual([...documentKeys.detail("ws1", "d1"), "download", 0]);
    expect(documentKeys.downloadMeta("ws1", "d1", 4)).toEqual([...documentKeys.detail("ws1", "d1"), "download", 4]);
  });

  it("puts every filtered sources entry under the sources root", () => {
    const root = documentKeys.sourcesRoot("ws1");
    expect(root).toEqual(["documents", "ws1", "sources"]);
    expect(documentKeys.sources("ws1")).toEqual([...root, ""]);
    expect(documentKeys.sources("ws1", "chat")).toEqual([...root, "chat"]);
  });

  it("keeps an asset's bytes outside the detail prefix so a realtime frame does not refetch them", () => {
    const detail = documentKeys.detail("ws1", "d1");
    const asset = documentKeys.asset("ws1", "d1", "a1");
    const idle = documentKeys.assetIdle("ws1", "d1");
    expect(asset).toEqual(["documents", "ws1", "asset", "d1", "a1"]);
    expect(idle).toEqual(["documents", "ws1", "asset", "d1", "idle"]);
    expect(startsWith(asset, detail)).toBe(false);
    expect(startsWith(idle, detail)).toBe(false);
  });

  it("scopes organization-level keys by organization rather than workspace", () => {
    expect(documentKeys.settings("org1")).toEqual(["documents", "settings", "org1"]);
    expect(documentKeys.favorites("org1")).toEqual(["documents", "favorites", "org1"]);
    expect(startsWith(documentKeys.favorites("org1"), documentKeys.favoritesRoot)).toBe(true);
    expect(documentKeys.public("tok")).toEqual(["documents", "public", "tok"]);
  });

  it("puts the archive impact under the workspace root so a document frame refreshes it", () => {
    const key = documentKeys.archiveImpact("ws1", "d1");
    expect(key).toEqual(["documents", "ws1", "archive-impact", "d1"]);
    expect(startsWith(key, documentKeys.workspace("ws1"))).toBe(true);
    expect(key).not.toEqual(documentKeys.archiveImpact("ws2", "d1"));
  });

  it("keeps the folders-only tree apart from the full one, under the same tree prefix", () => {
    const full = documentKeys.tree("ws1");
    const folders = documentKeys.tree("ws1", "", true);
    expect(folders).toEqual(["documents", "ws1", "tree", "", "folders_only"]);
    expect(folders).not.toEqual(full);
    expect(startsWith(folders, full)).toBe(true);
    expect(documentKeys.tree("ws1", "", false)).toEqual(full);
    expect(documentKeys.tree("ws1", "r1", true)).toEqual(["documents", "ws1", "tree", "r1", "folders_only"]);
  });

  it("answers recent, shared-with-me and shared-by-me under their own segments", () => {
    expect(documentKeys.recent("ws1")).toEqual(["documents", "ws1", "recent"]);
    expect(documentKeys.sharedWithMe("ws1")).toEqual(["documents", "ws1", "shared"]);
    expect(documentKeys.sharedByMe("ws1")).toEqual(["documents", "ws1", "shared-by-me"]);
    expect(documentKeys.shelved("ws1")).toEqual(["documents", "ws1", "shelved"]);
    expect(documentKeys.shelved("ws1", "f1")).toEqual(["documents", "ws1", "shelved", "f1"]);
    expect(documentKeys.shelved("ws1")).not.toEqual(documentKeys.shelved("ws2"));
  });

  // UNI-1868: the format/access chips are part of the key when they are set,
  // so two chip combinations never share a cache entry and switching a chip
  // starts from page 1; an unfiltered list keeps the key it had.
  it("keeps a chip-filtered collection apart from the unfiltered one, per workspace", () => {
    expect(documentKeys.recent("ws1", "f1")).toEqual(["documents", "ws1", "recent", "f1"]);
    expect(documentKeys.sharedWithMe("ws1", "f1")).toEqual(["documents", "ws1", "shared", "f1"]);
    expect(documentKeys.sharedByMe("ws1", "f1")).toEqual(["documents", "ws1", "shared-by-me", "f1"]);
    expect(documentKeys.recent("ws1", "f1")).not.toEqual(documentKeys.recent("ws1"));
    expect(documentKeys.recent("ws1", "f1")).not.toEqual(documentKeys.recent("ws1", "f2"));
    expect(documentKeys.recent("ws2", "f1")).not.toEqual(documentKeys.recent("ws1", "f1"));
    expect(startsWith(documentKeys.recent("ws1", "f1"), documentKeys.workspace("ws1"))).toBe(true);
  });
});
