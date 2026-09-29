import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxToolbar } from "./toolbar";
import { createPptxCommandMap } from "./command-map";

initI18n();
beforeEach(async () => { await setLocale("en"); });

describe("PptxToolbar", () => {
  it("shows a reason for an unavailable command and never dispatches it", () => {
    const onCommand = vi.fn();
    const commands = createPptxCommandMap({ host: null });
    render(<PptxToolbar commands={commands.filter((command) => command.id === "edit-shape-image")} onCommand={onCommand} />);
    const button = screen.getByRole("button", { name: "Shape / image" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("tooltip")).toHaveTextContent("host:slides-edit-transform");
    fireEvent.click(button);
    expect(onCommand).not.toHaveBeenCalled();
  });
});

