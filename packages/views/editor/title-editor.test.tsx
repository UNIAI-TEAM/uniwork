import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureShortcutPlatform,
  createShortcutChord,
  useShortcutStore,
} from "@uniwork/core/shortcuts";
import { TitleEditor } from "./title-editor";

beforeEach(() => {
  configureShortcutPlatform("windows");
  useShortcutStore.getState().resetAll();
});

afterEach(() => {
  useShortcutStore.getState().resetAll();
  configureShortcutPlatform(null);
});

describe("TitleEditor", () => {
  it("mounts a contenteditable surface", async () => {
    render(<TitleEditor defaultValue="Hello" />);
    expect(await screen.findByRole("textbox")).toHaveAttribute("contenteditable", "true");
  });
});

// No host passes `onSubmitShortcut` today. These pin the component contract
// for the first host that does, now that `send` has a default chord.
describe("TitleEditor onSubmitShortcut", () => {
  it("does not fire on plain Enter with the default send chord", async () => {
    const onSubmit = vi.fn();
    const onSubmitShortcut = vi.fn();
    render(
      <TitleEditor
        defaultValue="Half-typed"
        onSubmit={onSubmit}
        onSubmitShortcut={onSubmitShortcut}
      />,
    );
    const surface = await screen.findByRole("textbox");

    fireEvent.keyDown(surface, { key: "Enter" });

    // Plain Enter still reached the title keymap ("finish editing")...
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // ...and never the send chord (#5532).
    expect(onSubmitShortcut).not.toHaveBeenCalled();
  });

  it("fires once on primary+Enter with the default send chord", async () => {
    const onSubmit = vi.fn();
    const onSubmitShortcut = vi.fn();
    render(
      <TitleEditor
        defaultValue="Ready"
        onSubmit={onSubmit}
        onSubmitShortcut={onSubmitShortcut}
      />,
    );
    const surface = await screen.findByRole("textbox");

    fireEvent.keyDown(surface, { key: "Enter", ctrlKey: true });

    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still does not fire on plain Enter when send is set to plain Enter", async () => {
    useShortcutStore.getState().setShortcut("send", createShortcutChord("Enter"));
    const onSubmit = vi.fn();
    const onSubmitShortcut = vi.fn();
    render(
      <TitleEditor
        defaultValue="Half-typed"
        onSubmit={onSubmit}
        onSubmitShortcut={onSubmitShortcut}
      />,
    );
    const surface = await screen.findByRole("textbox");

    fireEvent.keyDown(surface, { key: "Enter" });

    expect(onSubmitShortcut).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
