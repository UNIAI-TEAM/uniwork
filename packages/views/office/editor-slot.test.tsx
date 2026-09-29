import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeHost } from "@uniwork/core/office";
import { EditorSlot, type OfficeEditorComponent } from "./editor-slot";

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
