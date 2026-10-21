import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { hasReaction, pollTapsToReach, toggledPollChoice, withPollChoice, withReaction } from "./optimistic-message";

const settings = { deadline_at: null, pin_to_top: false, allow_multiple: true, allow_add_options: true, hide_results_until_vote: false, hide_voters: false };
type Poll = NonNullable<ChatMessageRecord["poll"]>;
const poll = (viewer: string[], allowMultiple = true): Poll => ({
  question: "Ăn gì?",
  options: [
    { id: "a", label: "Phở", votes: viewer.includes("a") ? 1 : 0 },
    { id: "b", label: "Bún", votes: 2 },
  ],
  settings: { ...settings, allow_multiple: allowMultiple },
  viewer_option_ids: viewer,
  votes_by_user: undefined,
});
const message = (extra: Partial<ChatMessageRecord> = {}) => ({ id: "m1", reactions: {}, my_reactions: undefined, ...extra }) as unknown as ChatMessageRecord;

describe("optimistic reactions", () => {
  it("adds and removes the viewer's emoji and moves its count", () => {
    const on = withReaction(message({ reactions: { "👍": 2 } }), "👍", true);
    expect(on).toMatchObject({ reactions: { "👍": 3 }, my_reactions: ["👍"] });
    expect(hasReaction(on, "👍")).toBe(true);
    expect(withReaction(on, "👍", true)).toBe(on);
    const off = withReaction(message({ reactions: { "👍": 1 }, my_reactions: ["👍"] }), "👍", false);
    expect(off).toMatchObject({ reactions: {}, my_reactions: [] });
    expect(hasReaction(message(), "👍")).toBe(false);
  });
});

describe("optimistic poll votes", () => {
  it("toggles like the server: one option of many, or replaces a single choice", () => {
    expect(toggledPollChoice(poll(["a"]), "b")).toEqual(["a", "b"]);
    expect(toggledPollChoice(poll(["a", "b"]), "a")).toEqual(["b"]);
    expect(toggledPollChoice(poll(["a"], false), "b")).toEqual(["b"]);
    expect(toggledPollChoice(poll(["a"], false), "a")).toEqual([]);
  });

  it("sets the viewer's choice and the counts, and the viewer's row when the voters are shown", () => {
    const record = message({ poll: { ...poll(["a"]), votes_by_user: { U1: ["a"] } } });
    const next = withPollChoice(record, "u1", ["b"]);
    expect(next.poll?.viewer_option_ids).toEqual(["b"]);
    expect(next.poll?.options.map((o) => o.votes)).toEqual([0, 3]);
    expect(next.poll?.votes_by_user).toEqual({ U1: ["b"] });
    expect(withPollChoice(message({ poll: poll(["a"]) }), "u1", []).poll?.votes_by_user).toBeUndefined();
    expect(withPollChoice(record, "u1", ["a"])).toBe(record);
    const none = message();
    expect(withPollChoice(none, "u1", ["a"])).toBe(none);
  });

  it("works out the taps that take the server to the wish", () => {
    expect(pollTapsToReach(["a"], ["a"], true)).toEqual([]);
    expect(pollTapsToReach(["a"], ["b"], true)).toEqual(["a", "b"]);
    expect(pollTapsToReach(["a"], ["b"], false)).toEqual(["b"]);
    expect(pollTapsToReach(["a"], [], false)).toEqual(["a"]);
  });
});
