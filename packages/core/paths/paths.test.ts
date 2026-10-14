import { describe, expect, it } from "vitest";
import { paths } from "./paths";

describe("paths.workspace().documentsFolder", () => {
  const ws = paths.workspace("acme", "team");

  it("opens a folder through the documents route's query string", () => {
    expect(ws.documentsFolder("f1")).toBe("/acme/team/documents?folder=f1");
  });

  it("encodes the folder id", () => {
    expect(ws.documentsFolder("a/b?c&d")).toBe("/acme/team/documents?folder=a%2Fb%3Fc%26d");
  });

  // Not a page: the path part is the existing documents route, so the
  // builder ↔ page walk in consistency.test.ts has nothing new to match and
  // deliberately does not list it (no apps/web page backs `?folder=`).
  it("adds no route of its own", () => {
    const url = new URL(ws.documentsFolder("f1"), "http://x.test");
    expect(url.pathname).toBe(ws.documents());
    expect(url.searchParams.get("folder")).toBe("f1");
  });
});
