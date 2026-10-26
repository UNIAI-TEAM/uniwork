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
    ["stage", MeetingStagePageSkeleton],
    ["invite", MeetingInvitePageSkeleton],
  ])("%s skeleton announces loading and draws placeholder blocks", (_name, Skeleton) => {
    const { container } = render(wrap(<Skeleton />));
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Đang tải…")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  });

  it("draws the detail page in its real geometry: crumb, header, strip, tabs, the 680/288 grid", () => {
    const { container } = render(wrap(<MeetingDetailPageSkeleton />));
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Đang tải cuộc họp…")).toBeInTheDocument();
    expect(container.querySelector(".max-w-\\[100rem\\]")).not.toBeNull();
    expect(container.querySelector(".grid-cols-\\[minmax\\(0\\,1fr\\)_288px\\]")).not.toBeNull();
    // Bars only, never a spinner: the shape is the signal.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(20);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it("paints stage tiles on the meeting stage surface", () => {
    const { container } = render(wrap(<MeetingStagePageSkeleton />));
    const tiles = container.querySelectorAll(".bg-meeting-stage");
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });
});
