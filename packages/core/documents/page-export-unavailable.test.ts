import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageExportUnavailable } from "./hooks";

describe("usePageExportUnavailable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePageExportUnavailable.setState({ formats: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves a refused format out for ten minutes, then offers it again", () => {
    usePageExportUnavailable.getState().markUnavailable(["pdf"]);
    expect(usePageExportUnavailable.getState().formats).toEqual(["pdf"]);
    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(usePageExportUnavailable.getState().formats).toEqual(["pdf"]);
    vi.advanceTimersByTime(1);
    expect(usePageExportUnavailable.getState().formats).toEqual([]);
  });
});
