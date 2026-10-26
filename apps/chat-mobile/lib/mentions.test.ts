import { describe, expect, it } from "vitest";
import { mentionSegments } from "./mentions";

describe("mentionSegments", () => {
  it("splits a body into text and mention runs, with the user id of a member mention", () => {
    expect(mentionSegments("Hi [@Binh](mention://member/u2), and [@all](mention://all/all)!")).toEqual([
      { text: "Hi " },
      { text: "@Binh", mention: "member", userId: "u2" },
      { text: ", and " },
      { text: "@all", mention: "all" },
      { text: "!" },
    ]);
  });

  it("returns one text run for a body without tokens, and nothing for an empty one", () => {
    expect(mentionSegments("plain")).toEqual([{ text: "plain" }]);
    expect(mentionSegments("[@all](mention://all/all)")).toEqual([{ text: "@all", mention: "all" }]);
    expect(mentionSegments("")).toEqual([]);
  });
});
