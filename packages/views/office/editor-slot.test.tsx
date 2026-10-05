import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeHost } from "@uniwork/core/office";
import { EditorSlot, type OfficeEditorComponent } from "./editor-slot";
import { createMarkdownEditorLoader } from "./markdown/editor-slot";
import { createHtmlEditorLoader } from "./html/editor-slot";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const host = {
  read: { readDocument: vi.fn(), openDocument: vi.fn() },
  write: { writeOutput: vi.fn() },
  assets: { resolveFont: vi.fn(), resolveImage: vi.fn(), resolveAsset: vi.fn() },
  ipc: { call: vi.fn(), send: vi.fn(), subscribe: vi.fn() },
} as unknown as OfficeHost;

describe("EditorSlot", () => {
  it.each([
    ["unknown", "Editor capability is being checked"],
    ["unavailable", "This editor is unavailable"],
    ["readonly", "This editor is read-only"],
  ] as const)("shows the real %s capability state", (status, title) => {
    render(<EditorSlot format="docx" host={host} capability={status} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByTestId("office-editor-loading")).not.toBeInTheDocument();
  });

  it("shows loading without mounting an editor", () => {
    const loadEditor = vi.fn();
    render(<EditorSlot format="xlsx" host={host} capability="available" loadEditor={loadEditor} />);
    expect(screen.getByTestId("office-editor-loading")).toBeInTheDocument();
    expect(loadEditor).not.toHaveBeenCalled();
  });

  it("lazy-loads the format editor only after an open succeeds", async () => {
    const Editor: OfficeEditorComponent = () => <div data-testid="mounted-editor" />;
    const loadEditor = vi.fn(async () => ({ default: Editor }));
    render(
      <EditorSlot
        format="md"
        host={host}
        capability="available"
        openState="ready"
        loadEditor={loadEditor}
      />,
    );
    expect(await screen.findByTestId("mounted-editor")).toBeInTheDocument();
    expect(loadEditor).toHaveBeenCalledWith("md");
    const section = document.querySelector("[data-office-editor-slot]")!;
    expect(section.className).not.toMatch(/\b(p-3|p-4|rounded-lg|border)\b/);
  });

  it("pads only the message states", () => {
    render(<EditorSlot format="xlsx" host={host} capability="available" />);
    expect(document.querySelector("[data-office-editor-slot]")!.className).toContain("p-4");
  });

  it("mounts the Markdown and HTML loaders through EditorSlot and shows a typed missing-handle state", async () => {
    const markdownLoader = createMarkdownEditorLoader({ documentKey: "doc", open: {} as never, coordinator: {} as never });
    render(<EditorSlot format="md" host={host} capability="available" openState="ready" loadEditor={markdownLoader} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Markdown adapter returned an unknown open failure");
    cleanup();

    const htmlLoader = createHtmlEditorLoader({ documentKey: "doc", open: {} as never, coordinator: {} as never });
    render(<EditorSlot format="html" host={host} capability="available" openState="ready" loadEditor={htmlLoader} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTML adapter returned an unknown open failure");
  });

  it("distinguishes a pending format lane from mobile unsupported editing", () => {
    render(<EditorSlot format="docx" host={host} capability="available" openState="ready" />);
    expect(screen.getByText("Editor is still loading")).toBeInTheDocument();
    expect(screen.queryByText("Editing is not supported on this screen size")).not.toBeInTheDocument();
  });

  it.each([
    ["error", "The file could not be opened"],
    ["password-cancel", "Password entry was cancelled"],
  ] as const)("does not render an empty document after %s", (openState, title) => {
    const Editor: OfficeEditorComponent = () => <div data-testid="mounted-editor" />;
    render(
      <EditorSlot
        format="pptx"
        host={host}
        capability="available"
        openState={openState}
        loadEditor={async () => ({ default: Editor })}
      />,
    );
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByTestId("mounted-editor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("EditorSlot pending format message", () => {
  it.each([
    ["pptx", "PPTX"],
    ["md", "Markdown"],
    ["pdf", "PDF"],
    ["html", "HTML"],
  ] as const)("names %s by its display name, not the raw id", (format, display) => {
    render(<EditorSlot format={format} host={host} capability="available" openState="ready" />);
    const alert = screen.getByTestId("office-editor-pending");
    expect(alert).toHaveTextContent(`${display} editing is not available yet.`);
    expect(alert.textContent).not.toContain(`${format} editing`);
    expect(alert.className).not.toMatch(/\b(?:border-white|border-\[#)/);
    expect(alert.className).toContain("border-border");
  });
});
