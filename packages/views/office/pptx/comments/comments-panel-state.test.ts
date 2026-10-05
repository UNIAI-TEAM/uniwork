import { describe, expect, it } from "vitest";
import {
  commentAvatarLabel,
  commentDraftAfterAdd,
  commentDraftReady,
  commentRefKey,
  commentsPanelMode,
  formatCommentTime,
  PPTX_COMMENT_REPLY_RESOLVE_SUPPORTED,
} from "./comments-panel-state";

describe("commentsPanelMode", () => {
  it("reports unbound before every other state", () => {
    expect(commentsPanelMode({ slideIndex: null, loading: true, unbound: true })).toBe("unbound");
    expect(commentsPanelMode({ slideIndex: 0, loading: false, unbound: true })).toBe("unbound");
  });

  it("asks for a slide when none is selected", () => {
    expect(commentsPanelMode({ slideIndex: null, loading: false, unbound: false })).toBe("no_slide");
    expect(commentsPanelMode({ slideIndex: -2, loading: false, unbound: false })).toBe("no_slide");
    expect(commentsPanelMode({ slideIndex: 1.5, loading: false, unbound: false })).toBe("no_slide");
  });

  it("reports loading before ready", () => {
    expect(commentsPanelMode({ slideIndex: 0, loading: true, unbound: false })).toBe("loading");
    expect(commentsPanelMode({ slideIndex: 0, loading: false, unbound: false })).toBe("ready");
  });
});

describe("commentRefKey", () => {
  it("keys a comment by its authorId+idx identity", () => {
    expect(commentRefKey({ authorId: 2, idx: 3 })).toBe("2:3");
    expect(commentRefKey({ authorId: 0, idx: 0 })).toBe("0:0");
  });
});

describe("commentAvatarLabel", () => {
  it("prefers the engine initials", () => {
    expect(commentAvatarLabel({ author: "An Nguyen", initials: "AN" })).toBe("AN");
  });

  it("falls back to the author's first two characters", () => {
    expect(commentAvatarLabel({ author: "Binh", initials: "  " })).toBe("Bi");
  });

  it("returns a placeholder for an unknown author", () => {
    expect(commentAvatarLabel({ author: "   ", initials: "" })).toBe("?");
  });
});

describe("formatCommentTime", () => {
  it("formats a valid ISO timestamp and passes an empty string through", () => {
    const formatted = formatCommentTime("2026-10-04T09:00:00.000Z", "en");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatCommentTime("", "en")).toBe("");
  });

  it("returns an unparsable value unchanged instead of Invalid Date", () => {
    expect(formatCommentTime("not-a-date", "en")).toBe("not-a-date");
  });
});

describe("commentDraftReady", () => {
  const base = { author: "An", text: "Please review", readonly: false, pending: false, boundPort: true };

  it("requires both a non-empty author and text", () => {
    expect(commentDraftReady(base)).toBe(true);
    expect(commentDraftReady({ ...base, author: "   " })).toBe(false);
    expect(commentDraftReady({ ...base, text: "   " })).toBe(false);
  });

  it("refuses without a bound port, while readonly or while pending", () => {
    expect(commentDraftReady({ ...base, boundPort: false })).toBe(false);
    expect(commentDraftReady({ ...base, readonly: true })).toBe(false);
    expect(commentDraftReady({ ...base, pending: true })).toBe(false);
  });
});

describe("commentDraftAfterAdd", () => {
  it("clears only the exact posted draft", () => {
    expect(commentDraftAfterAdd("hello", "hello")).toBe("");
  });

  it("keeps text that changed while the add was in flight", () => {
    expect(commentDraftAfterAdd("hello there", "hello")).toBe("hello there");
  });
});

describe("reply/resolve support", () => {
  it("records that the engine registers no reply/resolve op", () => {
    expect(PPTX_COMMENT_REPLY_RESOLVE_SUPPORTED).toBe(false);
  });
});
