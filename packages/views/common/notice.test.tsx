import { render, screen } from "@testing-library/react";
import { Button } from "@uniwork/ui/components/ui/button";
import { CircleAlert } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Notice } from "./notice";

describe("Notice", () => {
  it("gives the action its own readable colour instead of the tone's", () => {
    // An outline button inherits the text colour; the destructive soft
    // foreground over the button's dark fill measured 4.09:1.
    render(
      <Notice tone="destructive" icon={CircleAlert} action={<Button variant="outline">Tải lại tệp</Button>}>
        Chưa tải được tệp lên.
      </Notice>,
    );
    const wrapper = screen.getByRole("button", { name: "Tải lại tệp" }).parentElement;
    expect(wrapper).toHaveClass("text-foreground");
    expect(screen.getByRole("status")).toHaveClass("text-destructive-soft-foreground");
  });

  it("wraps a long unbroken string such as a file name", () => {
    render(
      <Notice tone="warning" icon={CircleAlert}>
        ban-ghi-cuoc-hop-quy-3-khong-co-dau-cach.mp4
      </Notice>,
    );
    expect(screen.getByText("ban-ghi-cuoc-hop-quy-3-khong-co-dau-cach.mp4")).toHaveClass("wrap-anywhere", "min-w-0");
  });
});
