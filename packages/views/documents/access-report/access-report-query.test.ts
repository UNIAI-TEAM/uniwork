import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_QUERY, readReportQuery, writeReportQuery } from "./access-report-query";

// The report's URL state (UNI-2039 F2): the scope, the tab, every filter and
// the sort live in the query string, so a report can be shared and reloaded.

const read = (qs: string) => readReportQuery(new URLSearchParams(qs));

describe("readReportQuery", () => {
  it("reads an empty URL as the whole workspace, by document, newest change first, no filter", () => {
    expect(read("")).toEqual(DEFAULT_REPORT_QUERY);
    expect(DEFAULT_REPORT_QUERY).toEqual({
      folderId: undefined,
      view: "documents",
      filters: {},
      sort: "changed",
      order: "desc",
      kind: undefined,
    });
  });

  it("reads every filter, the tab, the kind and the sort", () => {
    expect(
      read(
        "folder=f1&view=person&q=%20h%C6%B0ng%20&principal=user:u2&level=manage,view&scope=organization&source=chat,direct&flag=public_link&non_default=1&sort=title&order=desc&kind=member",
      ),
    ).toEqual({
      folderId: "f1",
      view: "people",
      filters: {
        q: "hưng",
        principal: "user:u2",
        levels: ["view", "manage"],
        scope: "organization",
        sources: ["direct", "chat"],
        flag: "public_link",
        nonDefault: true,
      },
      sort: "title",
      order: "desc",
      kind: "member",
    });
  });

  it("drops values this build does not know instead of sending them", () => {
    expect(
      read("view=grid&level=owner,edit&scope=team&source=fax,link&flag=risky&non_default=yes&sort=size&order=up&kind=robot&principal=team:x"),
    ).toEqual({ ...DEFAULT_REPORT_QUERY, filters: { levels: ["edit"], sources: ["link"] } });
  });

  it("a sort without an order takes that column's default order", () => {
    expect(read("sort=title")).toMatchObject({ sort: "title", order: "asc" });
    expect(read("sort=changed")).toMatchObject({ sort: "changed", order: "desc" });
  });

  it("accepts a bare link principal (anyone with the link) and caps the search at 100 characters", () => {
    expect(read("principal=link").filters.principal).toBe("link");
    expect(read("principal=user:").filters.principal).toBeUndefined();
    expect(read(`q=${"a".repeat(140)}`).filters.q).toHaveLength(100);
  });
});

describe("writeReportQuery", () => {
  it("writes only what differs from the default and keeps params it does not own", () => {
    const qs = writeReportQuery(new URLSearchParams("utm=x&level=view"), {
      ...DEFAULT_REPORT_QUERY,
      folderId: "f1",
      filters: { flag: "direct_manage", levels: ["edit", "manage"], nonDefault: true, q: "  an " },
    });
    const out = new URLSearchParams(qs);
    expect(out.get("utm")).toBe("x");
    expect(out.get("folder")).toBe("f1");
    expect(out.get("flag")).toBe("direct_manage");
    expect(out.get("level")).toBe("edit,manage");
    expect(out.get("non_default")).toBe("1");
    expect(out.get("q")).toBe("an");
    for (const key of ["view", "sort", "order", "scope", "source", "principal", "kind"]) expect(out.has(key)).toBe(false);
  });

  it("round-trips through readReportQuery", () => {
    const state = {
      folderId: "f9",
      view: "people" as const,
      filters: { principal: "workspace:ws9", scope: "restricted", sources: ["owner", "break_glass"], levels: ["comment"] },
      sort: "title" as const,
      order: "desc" as const,
      kind: "other_workspace",
    };
    expect(read(writeReportQuery(new URLSearchParams(), state))).toEqual(state);
  });

  it("an empty state writes an empty query", () => {
    expect(writeReportQuery(new URLSearchParams("level=view&view=person"), DEFAULT_REPORT_QUERY)).toBe("");
  });
});
