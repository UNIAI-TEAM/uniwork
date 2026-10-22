// The Loại multi-select of the documents filter bar (UNI-2113), shared by the documents view tests.
import { fireEvent, screen, within } from "@testing-library/react";
import { initI18n } from "@uniwork/core/i18n";

const { t } = initI18n();

// Read per call: the locale is set after this module loads.
const name = () => new RegExp(`^${t("documents.home.filters.type")}`);

/** The select's trigger, named "Loại: …" in the session locale; null when the bar has none. */
export const typeFilterSelect = () => screen.queryByRole("combobox", { name: name() });

/** The chip x of one type (`docx` …), named "Bỏ lọc .docx"; null when that type is not picked. */
export const typeChipRemove = (key: string) =>
  screen.queryByRole("button", { name: t("documents.home.filters.type_remove", { type: t(`documents.home.chips.${key}`) }) });

/** Opens the Loại menu, toggles every given type (`all`, `page`, `docx` … `txt`) the way a click does, then closes it. */
export async function pickTypeFilter(...keys: string[]) {
  const trigger = await screen.findByRole("combobox", { name: name() });
  fireEvent.click(trigger);
  const listbox = await screen.findByRole("listbox");
  for (const key of keys) {
    const option = within(listbox).getByRole("option", { name: t(`documents.home.chips.${key}`) });
    // Base UI only commits a click that started on the item with a pointer.
    fireEvent.pointerDown(option);
    fireEvent.click(option);
  }
  fireEvent.keyDown(listbox, { key: "Escape" });
}
