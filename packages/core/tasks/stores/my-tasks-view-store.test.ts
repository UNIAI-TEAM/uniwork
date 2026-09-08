// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { myTasksViewStore } from "./my-tasks-view-store";

beforeEach(() => {
  myTasksViewStore.setState({ scope: "all" });
});

it("updates my-tasks scope", () => {
  myTasksViewStore.getState().setScope("assigned");
  expect(myTasksViewStore.getState().scope).toBe("assigned");
});

it("defaults view mode to board", () => {
  expect(myTasksViewStore.getState().viewMode).toBe("board");
});
