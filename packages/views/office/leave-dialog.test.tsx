// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { LeaveDialog } from "./leave-dialog";

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

  it("names the corner close button Close, so Stay is announced once", () => {
    render(<LeaveDialog open onOpenChange={vi.fn()} onSave={async () => true} onDiscard={async () => true} />);
    expect(screen.getAllByRole("button", { name: "Stay" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  // The reference look every frame dialog is aligned to: filled primary, close X, blurred scrim.
  it("is the reference dialog: filled primary, outlined/ghost others, blurred scrim", () => {
    render(<LeaveDialog open onOpenChange={vi.fn()} onSave={async () => true} onKeepDraft={async () => true} onDiscard={async () => true} />);
    const save = screen.getByRole("button", { name: "Save to UniWork" });
    expect(save.className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Keep draft on this device" }).className).not.toContain("bg-primary");
    const scrim = document.querySelector('[data-slot="dialog-overlay"]');
    expect(scrim?.className).toContain("backdrop-blur");
  });

  it("moves focus into the dialog and keeps it there while it is open", async () => {
    render(<button type="button">page</button>);
    const page = screen.getByRole("button", { name: "page" });
    page.focus();
    render(<LeaveDialog open onOpenChange={vi.fn()} onSave={async () => true} onDiscard={async () => true} />);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Tab from the last control wraps inside the dialog instead of reaching the page.
    const buttons = Array.from(dialog.querySelectorAll("button"));
    buttons[buttons.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(page).not.toHaveFocus();
  });

  it("hands focus to the host's finalFocus when it closes (the editor frame, not the page)", async () => {
    const finalFocus = vi.fn(() => false);
    const view = render(<LeaveDialog open onOpenChange={vi.fn()} onSave={async () => true} onDiscard={async () => true} finalFocus={finalFocus} />);
    await screen.findByRole("dialog");
    view.rerender(<LeaveDialog open={false} onOpenChange={vi.fn()} onSave={async () => true} onDiscard={async () => true} finalFocus={finalFocus} />);
    await waitFor(() => expect(finalFocus).toHaveBeenCalled());
  });

  it("closes on Stay without running a write", () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async () => true);
    render(<LeaveDialog open onOpenChange={onOpenChange} onSave={onSave} onKeepDraft={async () => true} onDiscard={async () => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("LeaveDialog discard", () => {
  it("paints Discard on the opaque soft destructive pair, not a translucent tint (visual V1 #3)", () => {
    // In dark the footer's raised fill under bg-destructive/20 measured 4.18:1; the soft pair holds 5.58.
    // The destructive variant is that pair now, so the button needs no override of its own.
    render(<LeaveDialog open dirty onOpenChange={vi.fn()} onSave={async () => true} onDiscard={async () => true} />);
    const discard = screen.getByRole("button", { name: "Discard changes" });
    for (const name of ["bg-destructive-soft", "text-destructive-soft-foreground", "hover:bg-destructive-soft-hover"]) expect(discard.className.split(" ")).toContain(name);
    expect(discard.className).not.toMatch(/(^| )(dark:)?(hover:)?bg-destructive\/\d+/);
  });
});
