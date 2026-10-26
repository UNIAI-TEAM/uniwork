import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";

beforeAll(() => {
  initI18n();
});

/** A feed whose one older page empties the backlog, as the transcript card renders it. */
function Feed({ fail = false }: { fail?: boolean }) {
  const [lines, setLines] = useState(["Câu mới"]);
  const [hasOlder, setHasOlder] = useState(true);
  const onLoad = async () => {
    if (fail) throw new Error("Failed to fetch");
    setLines((l) => ["Câu cũ nhất", ...l]);
    setHasOlder(false);
  };
  return (
    <ol>
      {hasOlder ? (
        <li>
          <MeetingFeedLoadOlder label="Tải lời thoại trước đó" loading={false} onLoad={onLoad} />
        </li>
      ) : null}
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ol>
  );
}

describe("MeetingFeedLoadOlder", () => {
  it("stays in the tab order while it loads and does not load twice", () => {
    const onLoad = vi.fn(async () => {});
    render(<MeetingFeedLoadOlder label="Tải lời thoại trước đó" loading onLoad={onLoad} />);
    const button = screen.getByRole("button", { name: "Tải lời thoại trước đó" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("hands focus to the oldest line once the last older page is in", async () => {
    render(<Feed />);
    const button = screen.getByRole("button", { name: "Tải lời thoại trước đó" });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Câu cũ nhất")).toHaveFocus();
  });

  it("says in place that the page did not load, and keeps the button", async () => {
    render(<Feed fail />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tải lời thoại trước đó" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được phần trước đó.");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lời thoại trước đó" })).toBeInTheDocument();
  });
});
