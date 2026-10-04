// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { EditorChrome } from "../../../common/chrome";
import { MarkdownWysiwygEditor } from "../editor";
import type { TextEditorHandle } from "../../../source-editor-types";
import { useMarkdownToolbarChromeTab } from "./chrome-tab";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = "# Title\n\nBody paragraph.\n";

function createHandle(): TextEditorHandle {
  let text = FIXTURE;
  const listeners = new Set<(next: string) => void>();
  return {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    source: {
      getText: () => text,
      setText: (next: string) => {
        if (next === text) return;
        text = next;
        listeners.forEach((listener) => listener(next));
      },
      subscribe: (listener: (next: string) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

let live: Editor | null = null;

/** The Markdown groups mounted in the SHARED chrome, exactly as a host would. */
function Harness() {
  const [handle] = useState(createHandle);
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  const tab = useMarkdownToolbarChromeTab(instance);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={setInstance} />
      <EditorChrome tabs={[tab]} viewModes={[{ id: "wysiwyg", label: "Visual" }, { id: "source", label: "Source" }]} activeViewMode="wysiwyg" />
    </div>
  );
}

async function waitForChrome() {
  await waitFor(() => expect(live).not.toBeNull());
  await waitFor(() => expect(screen.getByTestId("editor-chrome-commands")).toBeInTheDocument());
}

describe("useMarkdownToolbarChromeTab", () => {
  it("mounts the six C7 groups into the shared chrome's single command row", async () => {
    render(<Harness />);
    await waitForChrome();
    const row = screen.getByTestId("editor-chrome-commands");
    const ids = within(row)
      .getAllByRole("group")
      .map((group) => group.getAttribute("data-chrome-group"))
      .filter(Boolean);
    expect(ids).toEqual(["blockStyle", "inline", "link", "lists", "insert", "view"]);
    // Exactly one command row: the toolbar is chrome content, never a second bar.
    expect(screen.getAllByTestId("editor-chrome-commands")).toHaveLength(1);
    expect(screen.queryByTestId("md-toolbar")).not.toBeInTheDocument();
  });

  it("drives the M1 editor from a chrome control and reports active state", async () => {
    render(<Harness />);
    await waitForChrome();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    await waitFor(() => expect(live!.isActive("bold")).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("does not add undo/redo or Save to the Markdown groups", async () => {
    render(<Harness />);
    await waitForChrome();
    const row = screen.getByTestId("editor-chrome-commands");
    expect(within(row).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Save to UniWork" })).not.toBeInTheDocument();
  });
});
