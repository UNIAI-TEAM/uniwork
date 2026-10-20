import { describe, expect, it, vi } from "vitest";
import { DocsProtocolError } from "./docs-frame-protocol";
import { VIEW_VERSION_CAPABILITY, VIEW_VERSION_REQUEST, isViewVersionPayload, viewVersionCapabilities } from "./frame-version-view";
import {
  createViewVersionHandler,
  currentVersionHref,
  lostCommentVersion,
  parseVersionParam,
  versionViewHref,
} from "./version-view";

describe("frame-version-view contract (UNI-2033 T4 fake)", () => {
  it("names the request and the capability the fork adds", () => {
    expect(VIEW_VERSION_REQUEST).toBe("comments.viewVersion");
    expect(VIEW_VERSION_CAPABILITY).toBe("commentsViewVersion");
  });

  it("accepts only a comment id and a positive integer version", () => {
    expect(isViewVersionPayload({ comment_id: "c1", version_no: 3 })).toBe(true);
    for (const bad of [null, {}, { comment_id: "", version_no: 3 }, { comment_id: "c1", version_no: 0 }, { comment_id: "c1", version_no: 1.5 }, { comment_id: "c1", version_no: "3" }, { comment_id: 1, version_no: 3 }]) {
      expect(isViewVersionPayload(bad)).toBe(false);
    }
  });

  it("grants the capability only outside a version view", () => {
    expect(viewVersionCapabilities(false)).toEqual({ commentsViewVersion: true });
    expect(viewVersionCapabilities(true)).toEqual({});
  });
});

describe("version view params", () => {
  it("reads a positive integer and ignores anything else", () => {
    expect(parseVersionParam("2")).toBe(2);
    for (const bad of [null, undefined, "", "0", "-1", "1.5", "abc", "2x", "9007199254740993", " 2"]) {
      expect(parseVersionParam(bad)).toBeNull();
    }
  });

  it("builds the version and head hrefs, keeping the comment", () => {
    expect(versionViewHref("/o/w/documents/d1", 2, "c1")).toBe("/o/w/documents/d1?version=2&comment=c1");
    expect(versionViewHref("/o/w/documents/d1", 2)).toBe("/o/w/documents/d1?version=2");
    expect(currentVersionHref("/o/w/documents/d1", "c1")).toBe("/o/w/documents/d1?comment=c1");
    expect(currentVersionHref("/o/w/documents/d1", null)).toBe("/o/w/documents/d1");
  });
});

describe("lostCommentVersion", () => {
  const list = (comment: Record<string, unknown>) => ({ comments: [{ id: "c0", anchor_state: "exact" }, { id: "c1", ...comment }], unchanged: false });
  it("returns the version of a lost comment", () => {
    expect(lostCommentVersion(list({ anchor_state: "lost", anchor_version_no: 2 }), "c1")).toBe(2);
  });
  it("returns null for any other state, a missing number, another id or a malformed list", () => {
    expect(lostCommentVersion(list({ anchor_state: "stale", anchor_version_no: 2 }), "c1")).toBeNull();
    expect(lostCommentVersion(list({ anchor_state: "lost" }), "c1")).toBeNull();
    expect(lostCommentVersion(list({ anchor_state: "lost", anchor_version_no: null }), "c1")).toBeNull();
    expect(lostCommentVersion(list({ anchor_state: "lost", anchor_version_no: 0 }), "c1")).toBeNull();
    expect(lostCommentVersion(list({ anchor_state: "lost", anchor_version_no: 2 }), "other")).toBeNull();
    expect(lostCommentVersion({ comments: [], unchanged: true }, "c1")).toBeNull();
    for (const bad of [null, undefined, "x", [], { comments: "no" }, { comments: [null, 1] }]) {
      expect(lostCommentVersion(bad, "c1")).toBeNull();
    }
  });
});

describe("createViewVersionHandler", () => {
  it("pushes the version href and answers opened", () => {
    const go = vi.fn();
    const handle = createViewVersionHandler(go, () => "/o/w/documents/d1");
    expect(handle({ comment_id: "c1", version_no: 4 })).toEqual({ opened: true });
    expect(go).toHaveBeenCalledWith("/o/w/documents/d1?version=4&comment=c1");
  });

  it("refuses a malformed payload without navigating", () => {
    const go = vi.fn();
    const handle = createViewVersionHandler(go, () => "/o/w/documents/d1");
    expect(() => handle({ comment_id: "c1", version_no: -2 })).toThrow(DocsProtocolError);
    expect(go).not.toHaveBeenCalled();
  });
});
