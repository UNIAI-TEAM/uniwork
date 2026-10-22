import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatPageAuthLoading } from "./chat-page-auth-loading";

beforeAll(() => {
  initI18n();
});

describe("ChatPageAuthLoading", () => {
  it("keeps the page's one h1 and says it is loading, with the shapes hidden", () => {
    // The skeleton reads the room wallpaper through React Query, as the page does.
    render(wrap(<ChatPageAuthLoading />));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trò chuyện");
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
  });
});
