import { expect, it } from "vitest";
import { closeDocumentTab, cycleDocumentTab, openDocumentTab, selectDocumentTab, type DocumentTabState } from "./tab-model";

const empty: DocumentTabState<number> = { tabs: [], activeTabId: null };
const tab = (id: string, format = "docx") => ({ id, title: `${id}.${format}`, format, data: 1 });

it("opens format-neutral tabs and focuses an existing document without replacing its editor", () => {
  let state = empty;
  for (const format of ["docx", "xlsx", "pptx"]) state = openDocumentTab(state, tab(format, format)).state;
  expect(state.tabs.map((entry) => entry.format)).toEqual(["docx", "xlsx", "pptx"]);
  const repeat = openDocumentTab(state, { ...tab("docx"), data: 2 });
  expect(repeat.outcome).toBe("focused");
  expect(repeat.state.activeTabId).toBe("docx");
  expect(repeat.state.tabs[0]?.data).toBe(1);
  expect(repeat.state.tabs).toHaveLength(3);
});

it("keeps library pinned, switches through all tabs and chooses a neighbour when closing", () => {
  const first = openDocumentTab(empty, tab("a")).state;
  const second = openDocumentTab(first, tab("b")).state;
  expect(cycleDocumentTab(second, 1).activeTabId).toBeNull();
  expect(cycleDocumentTab(selectDocumentTab(second, null), -1).activeTabId).toBe("b");
  expect(closeDocumentTab(second, "b").activeTabId).toBe("a");
  expect(closeDocumentTab(selectDocumentTab(second, null), "a").activeTabId).toBeNull();
  expect(selectDocumentTab(second, "missing")).toBe(second);
  expect(closeDocumentTab(second, "missing")).toBe(second);
  expect(closeDocumentTab(first, "a")).toEqual(empty);
});

it("enforces eight document tabs but still focuses a duplicate at the limit", () => {
  let state = empty;
  for (let index = 0; index < 8; index++) state = openDocumentTab(state, tab(String(index))).state;
  expect(openDocumentTab(state, tab("ninth"))).toEqual({ state, outcome: "limit" });
  expect(openDocumentTab(state, tab("0")).outcome).toBe("focused");
});
