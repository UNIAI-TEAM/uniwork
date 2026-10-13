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
      documentKeys.sharedWithMe("ws1"),
      documentKeys.tree("ws1"),
      documentKeys.shares("ws1", "d1"),
      documentKeys.accessLogs("ws1", "d1"),
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
  });

  it("defaults the optional segments so a bare list or tree has a stable key", () => {
    expect(documentKeys.list("ws1")).toEqual(["documents", "ws1", "list", ""]);
    expect(documentKeys.list("ws1", "folder:f1")).toEqual(["documents", "ws1", "list", "folder:f1"]);
    expect(documentKeys.tree("ws1")).toEqual(["documents", "ws1", "tree", ""]);
    expect(documentKeys.tree("ws1", "root1")).toEqual(["documents", "ws1", "tree", "root1"]);
    expect(documentKeys.accessLogs("ws1", "d1")).toEqual([...documentKeys.detail("ws1", "d1"), "access-logs", ""]);
    expect(documentKeys.accessLogs("ws1", "d1", "download")).toEqual([...documentKeys.detail("ws1", "d1"), "access-logs", "download"]);
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

  it("answers recent and shared-with-me under their own segments", () => {
    expect(documentKeys.recent("ws1")).toEqual(["documents", "ws1", "recent"]);
    expect(documentKeys.sharedWithMe("ws1")).toEqual(["documents", "ws1", "shared"]);
  });
});
