// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DraftRecoveryPrompt, LeaveDialog } from "./leave-dialog";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("LeaveDialog", () => {
  it.each([
    ["save", "Save to UniWork"],
    ["keep", "Keep draft on this device"],
    ["discard", "Discard changes"],
  ] as const)("does not close when %s is not confirmed", async (choice, label) => {
    const onOpenChange = vi.fn();
    const action = vi.fn(async () => false);
    render(
      <LeaveDialog
        open
        onOpenChange={onOpenChange}
        onSave={choice === "save" ? action : async () => true}
        onKeepDraft={choice === "keep" ? action : async () => true}
        onDiscard={choice === "discard" ? action : async () => true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("waits for Save, then closes only after the coordinator confirms the receipt", async () => {
    const result = deferred<boolean>();
    const onOpenChange = vi.fn();
    render(<LeaveDialog open onOpenChange={onOpenChange} onSave={() => result.promise} onKeepDraft={async () => true} onDiscard={async () => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Save to UniWork" }));
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    result.resolve(true);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("stays open when a second edit leaves the coordinator dirty after receipt", async () => {
    const onOpenChange = vi.fn();
    render(<LeaveDialog open onOpenChange={onOpenChange} onSave={async () => false} onKeepDraft={async () => true} onDiscard={async () => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Save to UniWork" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes on Stay without running a write", () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async () => true);
    render(<LeaveDialog open onOpenChange={onOpenChange} onSave={onSave} onKeepDraft={async () => true} onDiscard={async () => true} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Stay" })[0]!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("DraftRecoveryPrompt", () => {
  it("offers recovery for the same base", () => {
    render(<DraftRecoveryPrompt open metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Recover draft" })).toBeInTheDocument();
  });

  it("does not offer silent recovery for a changed base", () => {
    render(<DraftRecoveryPrompt open conflict metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Recover draft" })).toBeNull();
    expect(screen.getByText("Draft conflict")).toBeInTheDocument();
  });

  it("does not offer recovery when the draft is locked", () => {
    render(<DraftRecoveryPrompt open recoverable={false} metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Recover draft" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Keep draft" }).some((button) => button.getAttribute("data-slot") !== "dialog-close")).toBe(true);
  });
});
