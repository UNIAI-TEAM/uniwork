import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingUnderlineTabBadge, MeetingUnderlineTabs } from "./meeting-underline-tabs";

beforeAll(() => {
  initI18n();
});

describe("MeetingUnderlineTabs", () => {
  it("marks the active tab with aria-selected", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["a", "b"] as const}
        value="a"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    expect(screen.getByRole("tab", { name: "a", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "b", selected: false })).toBeInTheDocument();
  });

  it("packs tabs to their label width instead of stretching them across the row", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["chat", "people", "files"] as const}
        value="chat"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    const tablist = screen.getByRole("tablist");
    expect(tablist).not.toHaveClass("justify-between");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).not.toHaveClass("flex-1");
      expect(tab.className).toMatch(/\bshrink-0\b/);
      expect(tab.className).toMatch(/whitespace-nowrap/);
    }
  });

  it("draws the active indicator under the selected tab", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["chat", "people"] as const}
        value="chat"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    const active = screen.getByRole("tab", { name: "chat", selected: true });
    const inactive = screen.getByRole("tab", { name: "people", selected: false });
    const indicator = active.querySelector("[data-slot='tab-indicator']");
    expect(indicator).not.toBeNull();
    expect(indicator?.className).toMatch(/\binset-x-0\b/);
    expect(indicator?.className).toMatch(/\bbottom-0\b/);
    expect(indicator?.className).toMatch(/\bbg-brand\b/);
    expect(inactive.querySelector("[data-slot='tab-indicator']")).toBeNull();
  });

  it("makes only the active tab reachable with Tab (roving tabindex)", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["chat", "people", "files"] as const}
        value="people"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    expect(screen.getByRole("tab", { name: "people" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "chat" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "files" })).toHaveAttribute("tabindex", "-1");
  });

  function Controlled({ onChange }: { onChange?: (tab: string) => void }) {
    const [value, setValue] = useState<"chat" | "people" | "files">("chat");
    return (
      <MeetingUnderlineTabs
        tabs={["chat", "people", "files"] as const}
        value={value}
        onChange={(tab) => {
          setValue(tab);
          onChange?.(tab);
        }}
        label={(tab) => tab}
      />
    );
  }

  it("moves focus and selection with ArrowRight/ArrowLeft, wrapping at the ends", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const chat = screen.getByRole("tab", { name: "chat" });
    chat.focus();
    fireEvent.keyDown(chat, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("people");
    expect(screen.getByRole("tab", { name: "people" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "people" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: "people" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "chat" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "chat" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("files");
    expect(screen.getByRole("tab", { name: "files" })).toHaveFocus();
  });

  it("jumps to the first/last tab with Home/End", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const chat = screen.getByRole("tab", { name: "chat" });
    chat.focus();
    fireEvent.keyDown(chat, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("files");
    expect(screen.getByRole("tab", { name: "files" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "files" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("chat");
    expect(screen.getByRole("tab", { name: "chat" })).toHaveFocus();
  });

  it("includes the badge count in the tab's accessible name", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["chat", "people"] as const}
        value="chat"
        onChange={() => {}}
        label={(tab) => (tab === "chat" ? "Trò chuyện" : "Mọi người")}
        badge={(tab) => (tab === "people" ? <MeetingUnderlineTabBadge>3</MeetingUnderlineTabBadge> : null)}
      />,
    );
    const people = screen.getByRole("tab", { name: /Mọi người/ });
    expect(people).not.toHaveAttribute("aria-label");
    expect(people).toHaveAccessibleName("Mọi người 3");
  });

  it("sizes the badge with the text-micro token", () => {
    render(<MeetingUnderlineTabBadge>5</MeetingUnderlineTabBadge>);
    const badge = screen.getByText("5");
    expect(badge.className).toMatch(/\btext-micro\b/);
    expect(badge.className).not.toMatch(/text-\[10px\]/);
  });
});
