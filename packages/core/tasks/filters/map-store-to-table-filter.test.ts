import { describe, it, expect } from "vitest";
import { mapStoreToTableFilter } from "./map-store-to-table-filter";
import type { FilterSnapshot } from "../stores/view-store-types";

const empty: FilterSnapshot = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
};

describe("mapStoreToTableFilter", () => {
  it("drops empty arrays and omits project when locked", () => {
    expect(
      mapStoreToTableFilter(
        {
          ...empty,
          statusFilters: ["todo"],
          projectFilters: ["p1"],
          includeNoProject: true,
        },
        { lockProjectFilter: true },
      ),
    ).toEqual({ statuses: ["todo"] });
  });

  it("maps creators to creator_refs and properties including __none__", () => {
    expect(
      mapStoreToTableFilter({
        ...empty,
        creatorFilters: [{ type: "member", id: "u1" }],
        propertyFilters: { p1: ["__none__", "opt"] },
        labelFilters: ["l1"],
        includeNoAssignee: true,
      }),
    ).toEqual({
      creator_refs: ["human:u1"],
      properties: { p1: ["__none__", "opt"] },
      label_ids: ["l1"],
      include_no_assignee: true,
    });
  });
});
