import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { duplicateLinkTarget } from "./duplicate-link";

const dup = (fields: Record<string, unknown>) => new ApiError("trùng", "active_duplicate_task", 409, undefined, fields);

describe("duplicateLinkTarget", () => {
  it("links the one refused item to the open task the server named", () => {
    expect(duplicateLinkTarget(dup({ action_item_ids: ["a1"], task_id: "t1" }))).toEqual({ itemId: "a1", taskId: "t1" });
  });

  it("guesses nothing for several items, no task, or another refusal", () => {
    expect(duplicateLinkTarget(dup({ action_item_ids: ["a1", "a2"], task_id: "t1" }))).toBeNull();
    expect(duplicateLinkTarget(dup({ action_item_ids: ["a1"] }))).toBeNull();
    expect(duplicateLinkTarget(new ApiError("x", "action_item_not_pending", 409, undefined, { action_item_ids: ["a1"], task_id: "t1" }))).toBeNull();
    expect(duplicateLinkTarget(new Error("network"))).toBeNull();
  });
});
