import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrap } from "../test/api-mock";
import { ChatDocumentPicker } from "./chat-document-picker";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const WS = "ws1";

function doc(id: string, title: string) {
  return {
    id,
    workspace_id: WS,
    organization_id: "org1",
    kind: "file",
    title,
    revision: "2",
    current_version: 2,
    my_level: "manage",
    updated_at: "2026-10-20T03:00:00Z",
  };
}

const OPENED = doc("d-opened", "Đã mở.docx");
/** A document the sender owns whose latest version is somebody else's: the
 *  server lists it on /documents/recent only when asked for include_owned. */
const OWNED_EDITED_BY_OTHER = doc("d-owned", "De-xuat.pdf");

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (!path.includes("/documents/recent")) return Promise.resolve({});
    const asked = new URLSearchParams(path.split("?")[1] ?? "").get("include_owned") === "true";
    return Promise.resolve({ documents: asked ? [OPENED, OWNED_EDITED_BY_OTHER] : [OPENED], next_cursor: null });
  });
});

describe("ChatDocumentPicker empty-query list (UNI-2012 F5)", () => {
  it("keeps a document the sender owns after somebody else's version", async () => {
    render(wrap(<ChatDocumentPicker open onOpenChange={vi.fn()} workspaceId={WS} roomId="room1" />));
    expect(await screen.findByText("De-xuat.pdf")).toBeInTheDocument();
    expect(screen.getByText("Đã mở.docx")).toBeInTheDocument();
    const recent = requestMock.mock.calls.map(([path]) => String(path)).filter((p) => p.includes("/documents/recent"));
    expect(recent.length).toBeGreaterThan(0);
    for (const path of recent) expect(new URLSearchParams(path.split("?")[1]).get("include_owned")).toBe("true");
  });

  it("orders the empty-query list by the sender's last activity, not by updated_at", async () => {
    render(wrap(<ChatDocumentPicker open onOpenChange={vi.fn()} workspaceId={WS} roomId="room1" />));
    await screen.findByText("De-xuat.pdf");
    const recent = requestMock.mock.calls.map(([path]) => String(path)).filter((p) => p.includes("/documents/recent"));
    expect(recent.length).toBeGreaterThan(0);
    for (const path of recent) {
      const params = new URLSearchParams(path.split("?")[1]);
      expect(params.get("sort")).toBe("activity");
      expect(params.has("order")).toBe(false);
    }
  });
});
