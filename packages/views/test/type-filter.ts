// The Loại select of the documents filter bar (UNI-2113), shared by the documents view tests.
import { fireEvent, screen, within } from "@testing-library/react";
import { initI18n } from "@uniwork/core/i18n";

const { t } = initI18n();

/** The select's trigger, named "Loại: …" in the session locale; null when the bar has none. */
export const typeFilterSelect = () =>
  screen.queryByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) });

/** Opens the Loại select and picks one type (`all`, `page`, `docx` … `txt`) the way a click does. */
export async function pickTypeFilter(key: string) {
  const trigger = await screen.findByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) });
  fireEvent.click(trigger);
  const option = within(await screen.findByRole("listbox")).getByRole("option", { name: t(`documents.home.chips.${key}`) });
  // Base UI only commits a click that started on the item with a pointer.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}
