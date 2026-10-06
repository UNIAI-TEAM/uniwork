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

  it("stays open when Save is not confirmed", async () => {
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
  it("formats the recovery timestamp with the active locale", async () => {
    await setLocale("vi");
    const updatedAt = Date.UTC(2026, 9, 3, 12, 58, 23);
    render(<DraftRecoveryPrompt open metadata={{ draftId: "draft", generation: 1, checksum: "sha256:abc", byteLength: 1, updatedAt, identity: { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { version: "1", revision: "1" } } }} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    const expected = new Intl.DateTimeFormat("vi", { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt));
    expect(screen.getByRole("dialog")).toHaveTextContent(expected);
  });

  it("offers recovery for the same base", () => {
    render(<DraftRecoveryPrompt open metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Recover draft" })).toBeInTheDocument();
  });

  it("does not offer silent recovery for a changed base", () => {
    render(<DraftRecoveryPrompt open conflict metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Recover draft" })).toBeNull();
    expect(screen.getByText("Draft conflict")).toBeInTheDocument();
  });

  it("keeps the destructive action last at every width (F9)", () => {
    // visual-r2 F9: the footer flipped order between 768 ("Keep draft" first)
    // and 390 ("Discard draft" first, destructive on top) because the mobile
    // base was `flex-col-reverse`. The destructive action must never be first.
    render(<DraftRecoveryPrompt open metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement;
    expect(footer.className).not.toContain("flex-col-reverse");
    const labels = Array.from(footer.querySelectorAll("button")).map((button) => button.textContent);
    expect(labels.indexOf("Discard draft")).toBeGreaterThan(labels.indexOf("Keep draft"));
  });

  it("does not offer recovery when the draft is locked", () => {
    render(<DraftRecoveryPrompt open recoverable={false} metadata={null} onRecover={async () => true} onDiscard={async () => true} onKeep={async () => true} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Recover draft" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Keep draft" }).some((button) => button.getAttribute("data-slot") !== "dialog-close")).toBe(true);
  });
});
