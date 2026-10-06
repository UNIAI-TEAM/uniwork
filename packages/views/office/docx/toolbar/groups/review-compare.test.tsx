// The group is the Review tab's wiring: it owns the dialog's open state and
// feeds the live-document reader to the dialog. The real parse path is mocked
// here so the group test can drive a successful comparison end to end.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { ReviewCompareGroup } from "./review-compare";

vi.mock("../../compare/read-compare", async (original) => ({
  ...(await original<typeof import("../../compare/read-compare")>()),
  readCompareFile: vi.fn(async () => ({ ok: true, texts: ["Alpha"] })),
}));

function runtime(): DocxCommandRuntime {
  return { compareDocumentTexts: vi.fn(() => ["Alpha"]) } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; ready?: boolean; readOnly?: boolean } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: { docxCompareReady: options.ready ?? true } as unknown as DocxToolbarGroupContext["format"],
    commands,
    selection: null,
    readOnly: options.readOnly ?? false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<ReviewCompareGroup {...props} />);
  return { commands };
}

describe("ReviewCompareGroup", () => {
  it("opens the compare dialog and reads the live document through the runtime", async () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-compare-toggle"));
    expect(screen.getByText(/Chỉ so sánh văn bản/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("docx-compare-file-input"), {
      target: { files: [new File([new Uint8Array([1])], "other.docx")] },
    });
    expect(await screen.findByTestId("docx-compare-summary")).toHaveTextContent(
      "Không có khác biệt trong phần văn bản được so sánh.",
    );
    expect(commands?.compareDocumentTexts).toHaveBeenCalledTimes(1);
  });

  it("disables the entry before a document is open", () => {
    renderGroup({ ready: false });
    expect(screen.getByTestId("docx-compare-toggle")).toBeDisabled();
  });

  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-compare-toggle")).toBeDisabled();
  });

  it("stays available on a read-only document — comparison only reads", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-compare-toggle")).toBeEnabled();
  });
});
