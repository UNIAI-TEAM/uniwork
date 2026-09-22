import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import {
  MeetingDetailPageSkeleton,
  MeetingInvitePageSkeleton,
  MeetingStagePageSkeleton,
} from "./meeting-page-skeletons";

beforeAll(() => {
  initI18n();
});

describe("meeting page skeletons", () => {
  it.each([
    ["detail", MeetingDetailPageSkeleton],
    ["stage", MeetingStagePageSkeleton],
    ["invite", MeetingInvitePageSkeleton],
  ])("%s skeleton announces loading and draws placeholder blocks", (_name, Skeleton) => {
    const { container } = render(wrap(<Skeleton />));
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Đang tải…")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  });

  it("paints stage tiles on the meeting stage surface", () => {
    const { container } = render(wrap(<MeetingStagePageSkeleton />));
    const tiles = container.querySelectorAll(".bg-meeting-stage");
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });
});
