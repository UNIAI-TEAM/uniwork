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

    expect(await screen.findByText("Tùy chỉnh bố cục")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tự động (linh hoạt)" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Lưới đều" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tiêu điểm" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Thanh bên" })).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Ẩn ô không có video" })).toBeChecked();
    // The close button speaks the room's language, not the primitive's English default.
    expect(screen.getByRole("button", { name: "Đóng" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
