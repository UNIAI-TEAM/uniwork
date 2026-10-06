import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPrintPort, isPrintBusy } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("isPrintBusy", () => {
  it("is true only while a print dialog may still be open", () => {
    expect(isPrintBusy({ outcome: "failed", reason: "print_busy" })).toBe(true);
    expect(isPrintBusy({ outcome: "failed", reason: "print_timeout" })).toBe(true);
    expect(isPrintBusy({ outcome: "failed", reason: "print_unavailable" })).toBe(false);
    expect(isPrintBusy({ outcome: "printed" })).toBe(false);
    expect(isPrintBusy({ outcome: "cancelled" })).toBe(false);
  });
});

describe("createBrowserPrintPort", () => {
  it("prints the copy from a hidden frame, never the app window, then removes the frame", async () => {
    vi.useFakeTimers();
    const appPrint = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const framePrints: string[] = [];
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      append(...nodes);
      const frame = nodes[0] as HTMLIFrameElement;
      const view = frame.contentWindow as Window;
      view.print = () => {
        framePrints.push(`${view.document.title}|${view.document.body.textContent ?? ""}`);
      };
    });

    const outcome = await createBrowserPrintPort().print({ html: "<!DOCTYPE html><html><body><p>Hello</p></body></html>", title: "Report" });

    expect(outcome).toEqual({ outcome: "printed" });
    expect(framePrints).toEqual(["Report|Hello"]);
    expect(appPrint).not.toHaveBeenCalled();
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    vi.runAllTimers();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("reports a blocked frame print as a typed failure and removes the frame", async () => {
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      append(...nodes);
      (nodes[0] as HTMLIFrameElement).contentWindow!.print = () => {
        throw new Error("blocked");
      };
    });

    expect(await createBrowserPrintPort().print({ html: "<p>x</p>", title: "x" })).toEqual({ outcome: "failed", reason: "print_blocked" });
    expect(document.querySelector("iframe")).toBeNull();
  });
});
