import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EmailChipsInput, parseEmails } from "./email-chips-input";

initI18n();

function H() {
  const [v, setV] = useState<string[]>([]);
  return <EmailChipsInput id="e" value={v} onChange={setV} />;
}

describe("EmailChipsInput", () => {
  it("parseEmails splits on separators and dedupes", () => {
    expect(parseEmails("a@x.com, B@x.com; a@x.com c@x.com\n")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
  it("Enter and paste add chips; invalid marked", () => {
    render(<H />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    fireEvent.paste(input, { clipboardData: { getData: () => "b@x.com, bad" } });
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
    expect(screen.getByText("bad").closest("[data-invalid]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Xóa bad/ }));
    expect(screen.queryByText("bad")).toBeNull();
  });
});
