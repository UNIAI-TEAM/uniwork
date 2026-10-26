import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { wrapWithNav } from "../../test/api-mock";
import { CanceledBody } from "./canceled-body";
import { DetailContext } from "./detail-context";
import { demo, demoUser, demoWorkspace, detailValue, routeMeeting } from "./test-fixtures";

describe("CanceledBody", () => {
  it("names each invitee's answer, a tentative one included", () => {
    routeMeeting("m3");
    setSessionUser(demoUser("lan"));
    // Hà accepted; Minh answers "maybe".
    const invitations = demo.meetings.m3.invitations.map((inv) =>
      inv.response_status === "PENDING" ? { ...inv, response_status: "TENTATIVE" } : inv,
    );
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
          <DetailContext.Provider value={detailValue("m3", { user: "lan", invitations })}>
            <CanceledBody />
          </DetailContext.Provider>
        </WorkspaceProvider>,
      ),
    );
    const minh = screen.getByText("Minh Trần").closest("li")!;
    expect(within(minh).getByText("Chưa chắc")).toBeInTheDocument();
    const ha = screen.getByText("Hà Vũ").closest("li")!;
    expect(within(ha).getByText("Nhận lời")).toBeInTheDocument();
  });
});
