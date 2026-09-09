import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContentEditor } from "./content-editor";

describe("ContentEditor smoke", () => {
  it("mounts a contenteditable editor", async () => {
    render(<ContentEditor placeholder="Add a description" />);

    await waitFor(() => {
      expect(document.querySelector('[contenteditable="true"]')).toBeInTheDocument();
    });
  });
});
