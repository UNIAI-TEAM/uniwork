import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { wrap } from "../../test/api-mock";
import { TableViewToolbar } from "./table-view-toolbar";

initI18n();

let storeCount = 0;

function renderToolbar() {
  storeCount += 1;
  const store = getTaskSurfaceViewStore(`table-toolbar-${storeCount}`);
  render(
    wrap(
      <ViewStoreProvider store={store}>
        <TableViewToolbar
          search=""
          onSearchChange={() => {}}
          projectGroupingDisabled={false}
          projectGroupingReason="capabilities.unknown"
          propertiesDisabled
          propertiesDisabledReason=""
          propertyGroupings={[{ value: "property:size", label: "Kích cỡ" }]}
        />
      </ViewStoreProvider>,
    ),
  );
  return store;
}

describe("TableViewToolbar grouping", () => {
  it("offers priority, project and each groupable property, and names the chosen property", async () => {
    const store = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Không nhóm" }));

    const options = (await screen.findAllByRole("menuitemradio")).map((el) =>
      el.textContent?.trim(),
    );
    expect(options).toEqual([
      "Không nhóm",
      "Trạng thái",
      "Ưu tiên",
      "Người phụ trách",
      "Dự án",
      "Kích cỡ",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Dự án" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Kích cỡ" }));
    expect(store.getState().tableGrouping).toBe("property:size");
    expect(await screen.findByRole("button", { name: "Kích cỡ" })).toBeInTheDocument();
  });
});
