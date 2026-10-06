/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OpenXlsxDocument } from "./xlsx-surface";
import type { RendererBridge } from "../app";
import type { DesktopXlsxSession } from "./xlsx-session";

// The shared editor is not under test here: only the surface's own markup.
vi.mock("@uniwork/views/office/xlsx", () => ({ XlsxEditor: () => <div data-testid="xlsx-editor-stub" /> }));

function textNodes(root: Node): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node.textContent ?? "");
  return out;
}

it("renders no stray text beside the editor (visual r3 R3-9: a ';' leaked into the tab panel)", async () => {
  const bridge = { call: vi.fn(async () => ({ drafts: [] })), onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const coordinator = { getState: () => ({ state: "clean" }), subscribe: () => () => undefined, save: vi.fn() };
  const session = {
    documentKey: "doc-1",
    editor: {},
    open: vi.fn(),
    coordinator,
    capability: "editable",
    canSave: true,
    listDrafts: vi.fn(async () => []),
    recoverDraft: vi.fn(),
    discardDraft: vi.fn(),
    rendererHostRef: { current: null, listeners: new Set() },
    dispose: vi.fn(),
  } as unknown as DesktopXlsxSession;
  const { container } = render(<OpenXlsxDocument bridge={bridge} session={session} title="Book.xlsx" onBack={() => undefined} />);
  await screen.findByTestId("xlsx-editor-stub");
  expect(textNodes(container).map((text) => text.trim())).not.toContain(";");
});
