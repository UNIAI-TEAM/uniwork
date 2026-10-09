import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { requestMock, wrap } from "../../test/api-mock";
import { useEffect } from "react";
import { DocxOpenSwitch } from "./docx-open-switch";
import { useDocsFrameRefusal } from "./docs-frame-refusal";

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

  it("opens the Docs frame by default when the answer does not name the flag", async () => {
    answer({ office_engine: true });
    render(wrap(ui));
    expect(await screen.findByText("docs frame")).toBeTruthy();
  });

  it("keeps the G3 editor when an override turns the flag off", async () => {
    answer({ office_engine: true, office_docs_web: false });
    render(wrap(ui));
    expect(await screen.findByText("g3 editor")).toBeTruthy();
    expect(screen.queryByText("docs frame")).toBeNull();
  });

  it("falls back to the G3 editor when the frame reports the server refused its token (flag turned off after the page cached it)", async () => {
    answer({ office_engine: true, office_docs_web: true });
    function RefusedFrame() {
      const refuse = useDocsFrameRefusal();
      useEffect(() => { refuse?.(); }, [refuse]);
      return <p>docs frame</p>;
    }
    render(wrap(<DocxOpenSwitch organizationId="org1" docsFrame={<RefusedFrame />} fallback={<p>g3 editor</p>} />));
    expect(await screen.findByText("g3 editor")).toBeTruthy();
    expect(screen.queryByText("docs frame")).toBeNull();
  });

  it("keeps the G3 editor when the answer cannot be read", async () => {
    requestMock.mockRejectedValue(new Error("offline"));
    render(wrap(ui));
    expect(await screen.findByText("g3 editor", undefined, { timeout: 4_000 })).toBeTruthy();
  });
});
