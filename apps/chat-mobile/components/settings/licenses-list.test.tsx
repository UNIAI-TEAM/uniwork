import { fireEvent, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { licenseEntries } from "@/lib/licenses";
import { render, viText } from "@/test/render";
import { LicensesList } from "./licenses-list";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const entries = licenseEntries([
  ["react", "19.2.3", "MIT"],
  ["livekit-client", "2.21.0", "Apache-2.0"],
  ["mystery", "1.0.0", ""],
]);

afterEach(() => jest.clearAllMocks());

describe("LicensesList", () => {
  it("thanks the packages, lists each with its license, and opens its npm page", async () => {
    await render(<LicensesList entries={entries} />);
    expect(screen.getByText(viText("mobile.licenses.intro", { count: 3 }))).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: "react 19.2.3, MIT" })).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: `mystery 1.0.0, ${viText("mobile.licenses.unknown")}` })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "livekit-client 2.21.0, Apache-2.0" }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://www.npmjs.com/package/livekit-client/v/2.21.0");
  });

  it("searches by name or license and says when nothing matches", async () => {
    await render(<LicensesList entries={entries} />);
    const search = screen.getByLabelText(viText("mobile.licenses.search"));
    await fireEvent.changeText(search, "apache");
    expect(screen.getByRole("link", { name: "livekit-client 2.21.0, Apache-2.0" })).toBeOnTheScreen();
    expect(screen.queryByRole("link", { name: "react 19.2.3, MIT" })).toBeNull();
    await fireEvent.changeText(search, "vue");
    expect(screen.getByText(viText("mobile.licenses.empty"))).toBeOnTheScreen();
  });

  it("shows the app's generated list by default", async () => {
    const first = licenseEntries(jest.requireActual("@/assets/licenses.json"))[0]!;
    await render(<LicensesList />);
    expect(screen.getByRole("link", { name: `${first.name} ${first.version}, ${first.license}` })).toBeOnTheScreen();
  });
});
