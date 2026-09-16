import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { taskKeys } from "@uniwork/core/tasks";
import { requestMock } from "../../test/api-mock";
import { useTaskLabelToggle } from "./use-task-label-toggle";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

function Harness({ checked }: { checked: boolean }) {
  const { toggle } = useTaskLabelToggle("w1", "t1");
  return (
    <button type="button" onClick={() => toggle("l1", checked)}>
      toggle
    </button>
  );
}

function renderHarness(checked: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <Harness checked={checked} />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(undefined);
});

describe("useTaskLabelToggle", () => {
  it("gắn thành công thì invalidate tableRoot của workspace, ngoài các invalidate sẵn có", async () => {
    const { invalidateSpy } = renderHarness(true);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.tableRoot("w1") }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.taskLabels("t1") });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.labels("w1") });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.detail("t1") });
  });

  it("gỡ thành công cũng invalidate tableRoot của workspace", async () => {
    const { invalidateSpy } = renderHarness(false);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.tableRoot("w1") }),
    );
  });

  it("gắn thất bại thì không invalidate tableRoot", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    const { invalidateSpy } = renderHarness(true);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: taskKeys.tableRoot("w1") });
  });
});
