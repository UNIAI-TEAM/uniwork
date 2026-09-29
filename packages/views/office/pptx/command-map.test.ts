import { describe, expect, it, vi } from "vitest";
import type { OfficeHost } from "@uniwork/core/office";
import { createPptxCommandMap } from "./command-map";

function host(call = vi.fn()): OfficeHost {
  return { read: {} as never, write: {} as never, assets: {} as never, ipc: { call, send: vi.fn(), subscribe: vi.fn() } };
}

describe("PPTX command map", () => {
  it("maps every mandatory row to a command and marks engine gaps", () => {
    const commands = createPptxCommandMap({ host: host() });
    const mandatory = commands.filter((command) => command.mandatoryRow);
    expect(mandatory).toHaveLength(12);
    expect(commands.find((command) => command.id === "export-pdf")?.capability.status).toBe("unavailable");
    expect(commands.find((command) => command.id === "edit-shape-image")?.capability.status).toBe("available");
  });

  it("renders shape gestures unavailable when the transform channel is absent", () => {
    const command = createPptxCommandMap({ host: null }).find((entry) => entry.id === "edit-shape-image");
    expect(command?.capability.status).toBe("unavailable");
    expect(command?.capability.reason).toContain("host:slides-edit-transform");
  });
});

