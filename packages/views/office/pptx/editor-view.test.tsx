import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeHost } from "@uniwork/core/office";
import { PptxEditorView } from "./editor-view";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const host = { read: {} as never, write: {} as never, assets: {} as never, ipc: { call: vi.fn(), send: vi.fn(), subscribe: vi.fn() } } as unknown as OfficeHost;

describe("PptxEditorView", () => {
  it.each([["error", "The file could not be opened"], ["password-cancel", "Password entry was cancelled"], ["unsupported", "Editing is not supported on this screen size"]] as const)("does not mount a blank editor for %s", (openState, title) => {
    render(<PptxEditorView title="Deck" host={host} capability="available" openState={openState} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByTestId("pptx-canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
