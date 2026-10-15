import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceIcon } from "./workspace-icon";

describe("WorkspaceIcon", () => {
  it("prefers the image, then the emoji, then the initial", () => {
    const { container, rerender } = render(
      <WorkspaceIcon workspace={{ name: "alpha", icon_emoji: "🚀", icon_url: "https://cdn/i.png" }} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/i.png");
    rerender(<WorkspaceIcon workspace={{ name: "alpha", icon_emoji: "🚀", icon_url: "" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("🚀");
    rerender(<WorkspaceIcon workspace={{ name: " alpha" }} />);
    expect(container).toHaveTextContent("A");
    rerender(<WorkspaceIcon workspace={{ name: "🚀 Rocket" }} />);
    expect(container).toHaveTextContent("🚀");
  });

  it("falls back to the emoji or the initial when the image does not load", () => {
    const { container } = render(<WorkspaceIcon workspace={{ name: "alpha", icon_url: "https://cdn/broken.png" }} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("A");
  });
});
