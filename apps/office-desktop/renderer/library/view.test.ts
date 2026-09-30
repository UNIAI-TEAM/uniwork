import { expect, it, vi } from "vitest";
import { renderLibrary } from "./view";
import type { DesktopLibraryDocument } from "../../shared/ipc";

type Node = { textContent: string | null; attrs: Record<string, string>; children: Node[]; listeners: Array<() => void>; setAttribute(name: string, value: string): void; appendChild(child: Node): void; addEventListener(_type: string, listener: () => void): void };
function domNode(): Node { return { textContent: "", attrs: {}, children: [], listeners: [], setAttribute(name, value) { this.attrs[name] = value; }, appendChild(child) { this.children.push(child); }, addEventListener(_type, listener) { this.listeners.push(listener); } }; }
const doc = { createElement: () => domNode() };
const row: DesktopLibraryDocument = { id: "doc-1", workspaceId: "ws", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "1", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };

it("renders open/download actions and engine-down status", () => {
  const root = domNode();
  const onOpen = vi.fn();
  const onDownload = vi.fn();
  renderLibrary(root, doc, { mode: "list", documents: [row], engineAvailable: false, onOpen, onDownload });
  expect(root.attrs["data-desktop-library"]).toBe("true");
  expect(root.children.some((child) => child.textContent?.includes("Editor unavailable"))).toBe(true);
  const list = root.children.at(-1)!;
  const item = list.children[0]!;
  item.children[1]!.listeners[0]!();
  item.children[2]!.listeners[0]!();
  expect(onOpen).toHaveBeenCalledWith(row);
  expect(onDownload).toHaveBeenCalledWith(row);
});

it("renders a translated empty state and mode callback", () => {
  const root = domNode();
  const onModeChange = vi.fn();
  renderLibrary(root, doc, { mode: "recent", documents: [], engineAvailable: true, onModeChange, t: (key) => `translated:${key}` });
  expect(root.children.at(-1)?.textContent).toBe("translated:empty");
  root.children[1]!.children[0]!.listeners[0]!();
  expect(onModeChange).toHaveBeenCalledWith("list");
});
