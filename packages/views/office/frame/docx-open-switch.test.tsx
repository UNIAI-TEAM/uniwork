import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { requestMock, wrap } from "../../test/api-mock";
import { DocxOpenSwitch } from "./docx-open-switch";

const ui = <DocxOpenSwitch organizationId="org1" docsFrame={<p>docs frame</p>} fallback={<p>g3 editor</p>} />;

function answer(flags: unknown) {
  requestMock.mockImplementation((path: string) => (path === "/api/v1/config?organization_id=org1"
    ? Promise.resolve({ flags })
    : Promise.reject(new Error(`unexpected ${path}`))));
}

afterEach(() => { requestMock.mockReset(); });

describe("DocxOpenSwitch", () => {
  it("opens the Docs frame when office_docs_web is on for the organization", async () => {
    answer({ office_engine: true, office_docs_web: true });
    render(wrap(ui));
    expect(screen.getByTestId("docx-open-switch-loading")).toBeTruthy();
    expect(await screen.findByText("docs frame")).toBeTruthy();
    expect(screen.queryByText("g3 editor")).toBeNull();
  });

  it("keeps the G3 editor when the flag is off or absent", async () => {
    answer({ office_engine: true });
    render(wrap(ui));
    expect(await screen.findByText("g3 editor")).toBeTruthy();
    expect(screen.queryByText("docs frame")).toBeNull();
  });

  it("keeps the G3 editor when the answer cannot be read", async () => {
    requestMock.mockRejectedValue(new Error("offline"));
    render(wrap(ui));
    expect(await screen.findByText("g3 editor", undefined, { timeout: 4_000 })).toBeTruthy();
  });
});
