import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatPageAuthLoading } from "./chat-page-auth-loading";

beforeAll(() => {
  initI18n();
});

describe("ChatPageAuthLoading", () => {
  it("keeps the page's one h1 and says it is loading, with the shapes hidden", () => {
    render(<ChatPageAuthLoading />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trò chuyện");
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
  });
});
