import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { wrapWithNav } from "../test/api-mock";
import { MeetingAdjustViewDialog } from "./meeting-adjust-view-dialog";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  useMeetingRoomPreferencesStore.setState({
    viewLayout: "auto",
    maxTiles: 6,
    hideTilesWithoutVideo: false,
  });
});

describe("MeetingAdjustViewDialog", () => {
  it("lists layout options and current view preferences", async () => {
    useMeetingRoomPreferencesStore.setState({ hideTilesWithoutVideo: true, maxTiles: 8 });
    render(
      wrapWithNav(<MeetingAdjustViewDialog open onOpenChange={() => {}} />),
    );

    expect(await screen.findByText("Căn chỉnh view")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tự động (linh hoạt)" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Lưới đều" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tiêu điểm" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Thanh bên" })).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Ẩn ô không có video" })).toBeChecked();
  });
});
