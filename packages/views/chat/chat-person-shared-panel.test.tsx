import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SharedItemList } from "./chat-person-shared-panel";

describe("SharedItemList", () => {
  it("tags a shared file with its extension and opens it when it has an address", () => {
    render(
      <SharedItemList
        kind="file"
        items={[
          { id: "f1", title: "Ke-hoach-Q4.docx", url: "https://files.example/f1", at: "2026-10-15T02:00:00Z" },
          { id: "f2", title: "ghi chu", at: "2026-10-15T02:01:00Z" },
        ]}
      />,
    );

    expect(screen.getByText("DOCX")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ke-hoach-Q4.docx" })).toHaveAttribute("href", "https://files.example/f1");
    // No extension, no address: the name alone, not a link.
    expect(screen.getByText("ghi chu").closest("a")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
