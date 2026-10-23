// The settings tab's segmented controls (theme, language): a titled radio group
// whose one checked segment is the current choice.
import { fireEvent, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { OptionGroup, type Option } from "./option-group";

const THEMES: Option<"light" | "dark">[] = [
  { value: "light", label: "settings.preferences.themeLight", icon: "sunny-outline" },
  { value: "dark", label: "settings.preferences.themeDark", icon: "moon-outline" },
];
const LANGUAGES: Option<"vi" | "en">[] = [
  { value: "vi", label: "settings.preferences.languageVi" },
  { value: "en", label: "settings.preferences.languageEn" },
];

it("checks the current choice and picks another with one tap, with or without icons", async () => {
  const pick = jest.fn();
  const view = await render(<OptionGroup title="Giao diện" options={THEMES} value="dark" onChange={pick} />);
  expect(screen.getByLabelText("Giao diện")).toBeOnTheScreen();
  expect(screen.getByRole("radio", { name: new RegExp(viText("settings.preferences.themeDark")), checked: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: new RegExp(viText("settings.preferences.themeLight")), checked: false }));
  expect(pick).toHaveBeenCalledWith("light");

  await view.rerender(<OptionGroup title="Ngôn ngữ" options={LANGUAGES} value="vi" onChange={pick} />);
  await fireEvent.press(screen.getByRole("radio", { name: new RegExp(viText("settings.preferences.languageEn")) }));
  expect(pick).toHaveBeenLastCalledWith("en");
});
