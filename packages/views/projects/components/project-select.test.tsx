import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { requestMock, wrap } from "../../test/api-mock";
import { ProjectSelect } from "./project-select";

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) =>
    String(path).includes("/projects") ? Promise.resolve({ projects: [], total: 0 }) : Promise.resolve({}),
  );
});

describe("ProjectSelect", () => {
  it("reads a project that is not in the list (deleted) as no project, never as its raw id", async () => {
    render(wrap(<ProjectSelect workspaceId="w1" value="01PGONE0000000000000000000" onChange={() => {}} noneLabel="Không thuộc dự án" ariaLabel="Dự án" />));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects"))).toBe(true));
    const trigger = screen.getByRole("combobox", { name: "Dự án" });
    expect(trigger).toHaveTextContent("Không thuộc dự án");
    expect(trigger).not.toHaveTextContent("01PGONE");
  });
});
