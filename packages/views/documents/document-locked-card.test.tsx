import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import {
  DocumentBreakGlassBanner,
  DocumentLockedCard,
} from "./document-locked-card";

const { t } = initI18n();

afterEach(() => {
  cleanup();
});

describe("DocumentLockedCard", () => {
  it("renders admin locked title, body, metadata, and break-glass reason form when canBreakGlass is true", () => {
    render(
      <DocumentLockedCard
        variant="admin"
        canBreakGlass
        metadata={{
          title: "Báo cáo lương Q4",
          ownerName: "Nguyễn Văn A",
          visibility: "restricted",
          updatedAt: "2026-10-14T08:30:00Z",
          sizeBytes: 2048,
        }}
        onGrantBreakGlass={vi.fn()}
      />,
    );

    expect(screen.getByText("Tài liệu này ở chế độ hạn chế")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Quản trị viên quản lý được tài liệu nhưng chỉ đọc được nội dung khi mở truy cập khẩn cấp.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Báo cáo lương Q4")).toBeInTheDocument();
    expect(screen.getByText("Hạn chế")).toBeInTheDocument();
    expect(screen.getByText("Chủ sở hữu: Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();

    expect(screen.getByLabelText("Lý do truy cập khẩn cấp")).toBeInTheDocument();
    expect(screen.getByTestId("break-glass-reason-counter")).toHaveTextContent("0/500");
    expect(
      screen.getByRole("button", { name: "Mở quyền Xem (24 giờ)" }),
    ).toBeInTheDocument();
  });

  it("validates reason trimmed length (< 10 shows reasonTooShort, > 500 shows reasonTooLong, 10..500 submits trimmed reason)", async () => {
    const onGrant = vi.fn().mockResolvedValue(undefined);
    render(
      <DocumentLockedCard
        variant="admin"
        canBreakGlass
        metadata={{ title: "Hợp đồng mật" }}
        onGrantBreakGlass={onGrant}
      />,
    );

    const textarea = screen.getByLabelText("Lý do truy cập khẩn cấp");
    const submitBtn = screen.getByRole("button", { name: "Mở quyền Xem (24 giờ)" });

    // 9 characters after trim -> too short
    fireEvent.change(textarea, { target: { value: "   123456789   " } });
    expect(screen.getByTestId("break-glass-reason-counter")).toHaveTextContent("9/500");
    expect(screen.getByRole("alert")).toHaveTextContent("Hãy nhập lý do ít nhất 10 ký tự.");
    fireEvent.click(submitBtn);
    expect(onGrant).not.toHaveBeenCalled();

    // 501 characters after trim -> too long
    fireEvent.change(textarea, { target: { value: "x".repeat(501) } });
    expect(screen.getByTestId("break-glass-reason-counter")).toHaveTextContent("501/500");
    expect(screen.getByRole("alert")).toHaveTextContent("Lý do tối đa 500 ký tự.");
    fireEvent.click(submitBtn);
    expect(onGrant).not.toHaveBeenCalled();

    // 10 characters after trim -> valid, submits trimmed reason
    fireEvent.change(textarea, { target: { value: "  Kiểm toán!  " } });
    expect(screen.getByTestId("break-glass-reason-counter")).toHaveTextContent("10/500");
    expect(screen.queryByTestId("break-glass-reason-error")).not.toBeInTheDocument();

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(onGrant).toHaveBeenCalledTimes(1);
    });
    expect(onGrant).toHaveBeenCalledWith("Kiểm toán!");
  });

  it("hides the break-glass reason form when canBreakGlass is false (can_break_glass=false)", () => {
    render(
      <DocumentLockedCard
        variant="admin"
        canBreakGlass={false}
        metadata={{ title: "Biên bản họp HĐQT" }}
        onGrantBreakGlass={vi.fn()}
      />,
    );

    expect(screen.getByText("Tài liệu này ở chế độ hạn chế")).toBeInTheDocument();
    expect(screen.getByText("Biên bản họp HĐQT")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lý do truy cập khẩn cấp")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mở quyền Xem (24 giờ)" }),
    ).not.toBeInTheDocument();
  });

  it("renders the member stub without the break-glass form when variant='member'", () => {
    render(<DocumentLockedCard variant="member" />);

    expect(screen.getByTestId("document-locked-card-member")).toBeInTheDocument();
    expect(screen.getByText("Bạn cần quyền truy cập tài liệu này")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lý do truy cập khẩn cấp")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mở quyền Xem (24 giờ)" }),
    ).not.toBeInTheDocument();
  });

  it("renders DocumentBreakGlassBanner active and expired states and triggers onEndAccess", () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <DocumentBreakGlassBanner
        expiresAt="2026-10-15T12:00:00Z"
        onEndAccess={onEnd}
      />,
    );

    expect(screen.getByTestId("break-glass-active-banner")).toHaveTextContent(
      /Bạn đang xem bằng truy cập khẩn cấp \(chỉ xem\) đến/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kết thúc truy cập" }));
    expect(onEnd).toHaveBeenCalledTimes(1);

    rerender(<DocumentBreakGlassBanner expired />);
    expect(screen.getByTestId("break-glass-expired-banner")).toHaveTextContent(
      "Truy cập khẩn cấp đã hết hạn. Mở lại truy cập khẩn cấp nếu bạn vẫn cần kiểm tra tài liệu này.",
    );
  });

  it("counts the reason in code points like the server's runes (R21 L6)", () => {
    render(
      <DocumentLockedCard variant="admin" canBreakGlass onGrantBreakGlass={vi.fn()} />,
    );
    // Ten emoji are 20 UTF-16 units but 10 runes: exactly the minimum.
    fireEvent.change(screen.getByLabelText(t("documents.breakGlass.reasonLabel")), {
      target: { value: "😀".repeat(10) },
    });
    expect(screen.getByTestId("break-glass-reason-counter")).toHaveTextContent("10/500");
    expect(screen.queryByTestId("break-glass-reason-error")).toBeNull();
  });

  it.each([
    ["too long", { min: 10, max: 500, length: 501 }, "documents.breakGlass.reasonTooLong"],
    ["too short", { min: 10, max: 500, length: 3 }, "documents.breakGlass.reasonTooShort"],
  ])("maps a 422 reason that is %s to its own message", async (_name, fields, key) => {
    const onGrant = vi
      .fn()
      .mockRejectedValue(
        new ApiError("invalid", "break_glass_reason_invalid", 422, undefined, fields, "validation"),
      );
    render(<DocumentLockedCard variant="admin" canBreakGlass onGrantBreakGlass={onGrant} />);
    fireEvent.change(screen.getByLabelText(t("documents.breakGlass.reasonLabel")), {
      target: { value: "Kiểm tra sự cố bảo mật khẩn cấp" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.breakGlass.confirmButton") }));
    expect(await screen.findByText(t(key))).toBeInTheDocument();
  });

  it("uses the role type scale and the shared focus ring, with one id per mounted card (R21 M4)", () => {
    const { container } = render(
      <>
        <DocumentLockedCard variant="admin" canBreakGlass onGrantBreakGlass={vi.fn()} />
        <DocumentLockedCard variant="admin" canBreakGlass onGrantBreakGlass={vi.fn()} />
      </>,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/\btext-(xs|sm|base)\b/);
    const areas = screen.getAllByLabelText(t("documents.breakGlass.reasonLabel"));
    expect(areas).toHaveLength(2);
    expect(areas[0]!.id).not.toBe(areas[1]!.id);
    expect(areas[0]).toHaveAttribute("data-slot", "textarea");
  });

  it("shows the pending banner with a retry while the grant has not opened the document yet", () => {
    const onRetry = vi.fn();
    render(
      <DocumentLockedCard variant="admin" grantPending onRetryOpen={onRetry} onGrantBreakGlass={vi.fn()} />,
    );
    expect(screen.getByTestId("break-glass-pending-banner")).toHaveTextContent(
      t("documents.breakGlass.grantedPending"),
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps End access disabled until the grant id is known", () => {
    render(<DocumentBreakGlassBanner expiresAt="2026-10-15T12:00:00Z" endDisabled onEndAccess={vi.fn()} />);
    expect(screen.getByRole("button", { name: t("documents.breakGlass.endAccessButton") })).toBeDisabled();
  });
});
