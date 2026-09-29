import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { toast } from "sonner";
import { playJoinRequestChime } from "./join-request-chime";
import { useJoinRequestAlert } from "./use-join-request-alert";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }));
vi.mock("./join-request-chime", () => ({ playJoinRequestChime: vi.fn() }));

beforeAll(() => {
  initI18n();
});

function request(id: string, name: string): MeetingJoinRequest {
  return { id, meeting_id: "m1", status: "PENDING", display_name_snapshot: name } as MeetingJoinRequest;
}

type Props = { pending: MeetingJoinRequest[] };

function setup(initial: MeetingJoinRequest[]) {
  const onApprove = vi.fn();
  const onOpenPeople = vi.fn();
  const view = renderHook(({ pending }: Props) => useJoinRequestAlert({ pending, onApprove, onOpenPeople }), {
    initialProps: { pending: initial },
  });
  return { ...view, onApprove, onOpenPeople };
}

type ToastOptions = {
  id: string;
  action: { label: string; onClick: () => void };
  cancel: { label: string; onClick: () => void };
};

function lastToastOptions(): ToastOptions {
  const calls = vi.mocked(toast).mock.calls;
  return calls.at(-1)?.[1] as unknown as ToastOptions;
}

describe("useJoinRequestAlert", () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear();
    vi.mocked(toast.dismiss).mockClear();
    vi.mocked(playJoinRequestChime).mockClear();
  });

  it("stays quiet while nobody is waiting", () => {
    setup([]);
    expect(toast).not.toHaveBeenCalled();
    expect(playJoinRequestChime).not.toHaveBeenCalled();
  });

  it("toasts and chimes once for each new knock, with admit and view actions", () => {
    const { rerender, onApprove, onOpenPeople } = setup([]);

    rerender({ pending: [request("jr1", "kim kim")] });
    expect(toast).toHaveBeenCalledOnce();
    expect(vi.mocked(toast).mock.calls[0]?.[0]).toBe("kim kim đang xin vào phòng");
    expect(playJoinRequestChime).toHaveBeenCalledOnce();

    const options = lastToastOptions();
    expect(options.action.label).toBe("Duyệt");
    options.action.onClick();
    expect(onApprove).toHaveBeenCalledWith("jr1");
    expect(options.cancel.label).toBe("Xem");
    options.cancel.onClick();
    expect(onOpenPeople).toHaveBeenCalledOnce();

    // A refetch with the same request does not ring again.
    rerender({ pending: [request("jr1", "kim kim")] });
    expect(toast).toHaveBeenCalledOnce();
    expect(playJoinRequestChime).toHaveBeenCalledOnce();

    rerender({ pending: [request("jr1", "kim kim"), request("jr2", "lan")] });
    expect(toast).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast).mock.calls[1]?.[0]).toBe("lan đang xin vào phòng");
    expect(playJoinRequestChime).toHaveBeenCalledTimes(2);
  });

  it("alerts for guests already waiting when the host enters the room", () => {
    setup([request("jr1", "kim kim"), request("jr2", "lan")]);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(playJoinRequestChime).toHaveBeenCalledOnce();
  });

  it("keeps the toast of a guest already waiting through a StrictMode remount", () => {
    renderHook(() => useJoinRequestAlert({ pending: [request("jr1", "kim kim")], onApprove: vi.fn() }), {
      wrapper: StrictMode,
    });
    const shownAt = vi.mocked(toast).mock.invocationCallOrder;
    const dismissedAt = vi.mocked(toast.dismiss).mock.invocationCallOrder;
    expect(shownAt.length).toBeGreaterThan(0);
    expect(Math.max(...shownAt)).toBeGreaterThan(Math.max(0, ...dismissedAt));
  });

  it("dismisses the toast once the request is no longer pending", () => {
    const { rerender } = setup([request("jr1", "kim kim")]);
    const { id } = lastToastOptions();

    rerender({ pending: [] });
    expect(toast.dismiss).toHaveBeenCalledWith(id);
  });

  it("clears its toasts when the room unmounts", () => {
    const { unmount } = setup([request("jr1", "kim kim")]);
    const { id } = lastToastOptions();

    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith(id);
  });
});
