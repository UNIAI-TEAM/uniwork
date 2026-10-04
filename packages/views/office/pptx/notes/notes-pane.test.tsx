import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxNotesPane } from "./notes-pane";
import { notesI18nResources } from "./notes-i18n";

const i18n = initI18n();
i18n.addResourceBundle("en", "translation", notesI18nResources("en"), true, true);
i18n.addResourceBundle("vi", "translation", notesI18nResources("vi"), true, true);
beforeEach(async () => { await setLocale("en"); });

describe("PptxNotesPane", () => {
  it("renders the bound notes of the selected slide with a saved status", () => {
    render(<PptxNotesPane slideIndex={0} notes="Opening remarks" onCommitNotes={vi.fn()} />);
    const pane = screen.getByRole("region", { name: "Speaker notes" });
    expect(pane).toHaveAttribute("data-pptx-notes-mode", "ready");
    expect(screen.getByTestId("pptx-notes-pane")).toBe(pane);
    expect(screen.getByText("Notes for slide 1")).toBeInTheDocument();
    const field = screen.getByRole("textbox");
    expect(field).toHaveValue("Opening remarks");
    expect(pane.querySelector("[data-pptx-notes-status]")).toHaveAttribute("data-pptx-notes-status", "saved");
    expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
  });

  it("marks the draft dirty and commits it once with Ctrl+Enter", () => {
    const onCommitNotes = vi.fn();
    render(<PptxNotesPane slideIndex={1} notes="old" onCommitNotes={onCommitNotes} />);
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "new notes" } });
    expect(screen.getByTestId("pptx-notes-pane").querySelector("[data-pptx-notes-status]")).toHaveAttribute("data-pptx-notes-status", "dirty");
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onCommitNotes).toHaveBeenCalledTimes(1);
    expect(onCommitNotes).toHaveBeenCalledWith(1, "new notes");
  });

  it("commits through the button and reverts the draft with Escape", () => {
    const onCommitNotes = vi.fn();
    render(<PptxNotesPane slideIndex={0} notes="bound" onCommitNotes={onCommitNotes} />);
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    expect(onCommitNotes).toHaveBeenCalledWith(0, "edited");
    fireEvent.change(field, { target: { value: "again" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue("bound");
    expect(onCommitNotes).toHaveBeenCalledTimes(1);
  });

  it("does not commit while pending", () => {
    const onCommitNotes = vi.fn();
    render(<PptxNotesPane slideIndex={0} notes="bound" pending onCommitNotes={onCommitNotes} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "edited" } });
    expect(screen.getByTestId("pptx-notes-pane").querySelector("[data-pptx-notes-status]")).toHaveAttribute("data-pptx-notes-status", "pending");
    expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
    expect(onCommitNotes).not.toHaveBeenCalled();
  });

  it("stays honest when no notes port is bound", () => {
    render(<PptxNotesPane slideIndex={0} notes="x" />);
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "unbound");
    expect(screen.getByTestId("pptx-notes-unbound")).toHaveTextContent("not connected");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save notes" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pptx-notes-status")).not.toBeInTheDocument();
  });

  it("honours an explicit unbound override even with a bound port", () => {
    render(<PptxNotesPane slideIndex={0} notes="x" unbound onCommitNotes={vi.fn()} />);
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "unbound");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("asks for a slide when none is selected", () => {
    render(<PptxNotesPane slideIndex={null} notes={null} onCommitNotes={vi.fn()} />);
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "no_slide");
    expect(screen.getByTestId("pptx-notes-no-slide")).toHaveTextContent("Select a slide");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pptx-notes-status")).not.toBeInTheDocument();
  });

  it("shows a loading status while the host fetches the notes", () => {
    render(<PptxNotesPane slideIndex={0} notes={null} loading onCommitNotes={vi.fn()} />);
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "loading");
    expect(screen.getByTestId("pptx-notes-loading")).toHaveTextContent("Loading speaker notes");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pptx-notes-status")).not.toBeInTheDocument();
  });

  it("keeps the notes readable and hides the commit control on a read-only document", () => {
    render(<PptxNotesPane slideIndex={0} notes="locked" readonly onCommitNotes={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save notes" })).not.toBeInTheDocument();
    expect(screen.getByText("This presentation is read-only.")).toBeInTheDocument();
  });

  it("surfaces a host error as an alert without losing the draft", () => {
    render(<PptxNotesPane slideIndex={0} notes="bound" error="no_slide: slide index 9 does not exist" onCommitNotes={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The notes could not be saved");
    expect(alert).toHaveTextContent("no_slide: slide index 9 does not exist");
    expect(screen.getByRole("textbox")).toHaveValue("bound");
  });

  it("closes through the labelled control when the host supplies one", () => {
    const onClose = vi.fn();
    render(<PptxNotesPane slideIndex={0} notes="" onCommitNotes={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close speaker notes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
