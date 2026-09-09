import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TitleEditor } from "./title-editor";

describe("TitleEditor smoke", () => {
  it("mounts a contenteditable editor", async () => {
    render(<TitleEditor placeholder="Task title" />);

    await waitFor(() => {
      expect(document.querySelector('[contenteditable="true"]')).toBeInTheDocument();
    });
  });
});
