import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEmailHubShortcuts, type EmailHubShortcutHandlers } from "./use-email-hub-shortcuts";

function Harness(props: EmailHubShortcutHandlers) {
  useEmailHubShortcuts(props);
  return <input aria-label="field" />;
}

describe("useEmailHubShortcuts", () => {
  it("runs the reading keys while on", () => {
    const onArchive = vi.fn();
    const onHelp = vi.fn();
    render(<Harness enabled reading onArchive={onArchive} onHelp={onHelp} />);
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "?" });
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it("ignores every single-character key once turned off (WCAG 2.1.4), Esc still goes back", () => {
    const onArchive = vi.fn();
    const onHelp = vi.fn();
    const onBack = vi.fn();
    const onCompose = vi.fn();
    render(<Harness enabled={false} reading onArchive={onArchive} onHelp={onHelp} onBack={onBack} onCompose={onCompose} />);
    for (const key of ["e", "?", "c", "#", "u"]) fireEvent.keyDown(window, { key });
    expect(onArchive).not.toHaveBeenCalled();
    expect(onHelp).not.toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("never fires while typing", () => {
    const onCompose = vi.fn();
    const { getByLabelText } = render(<Harness enabled reading={false} onCompose={onCompose} />);
    fireEvent.keyDown(getByLabelText("field"), { key: "c" });
    expect(onCompose).not.toHaveBeenCalled();
  });
});
