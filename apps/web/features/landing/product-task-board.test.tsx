import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { ProductTaskBoard } from "./product-task-board";
import { DEMO_PEOPLE, DEMO_TASKS } from "./product-task-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await setLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("ProductTaskBoard avatars", () => {
  it("shows the first letter of the person's name, not of the person code", async () => {
    await act(async () => { root.render(createElement(ProductTaskBoard, { tasks: DEMO_TASKS, selected: "design", open: true, onOpenChange: () => {} })); });
    // Detail panel: the open task is "design", assigned to code TN.
    const detail = container.querySelector('[data-demo-detail="task"] .product-task-assignee')!;
    expect(detail.textContent).toBe(`${DEMO_PEOPLE.TN!.charAt(0)}${DEMO_PEOPLE.TN}`);
    expect(detail.textContent).not.toMatch(/^T/);
  });
});
