import { fireEvent, screen } from "@testing-library/react-native";
import { render as rtlRender } from "@testing-library/react-native";
import { reportError } from "@/data/report";
import { viText } from "@/test/render";
import { ErrorFallback } from "./error-fallback";

jest.mock("@/data/report", () => ({ reportError: jest.fn() }));

describe("ErrorFallback", () => {
  // A root boundary renders outside every provider: no wrapper here on purpose.
  it("says what happened in the app's language, reports the crash once and retries", async () => {
    const error = new TypeError("undefined is not an object");
    const retry = jest.fn(async () => {});
    await rtlRender(<ErrorFallback error={error} retry={retry} boundary="root" />);
    expect(screen.getByRole("header", { name: viText("mobile.app.error_title") })).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.app.error_body"))).toBeOnTheScreen();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error, { source: "boundary:root", force: true });
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.app.error_retry") }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
