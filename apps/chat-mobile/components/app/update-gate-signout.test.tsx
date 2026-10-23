// The update gate on the real remote-config query across a sign-out: the gate
// is mounted once at the root and never remounts, so a sign-out that drops the
// query under it would freeze it on the old answer (no more foreground checks).
import { act, screen } from "@testing-library/react-native";
import { focusManager } from "@tanstack/react-query";
import { Text } from "react-native";
import { clearAccountCache } from "@/data/remote-config";
import { render, viText } from "@/test/render";
import { UpdateGate } from "./update-gate";

const mockApi = { request: jest.fn<Promise<unknown>, [string, RequestInit?]>() };
// Read at call time: the factory runs before this file's consts.
jest.mock("@/data/api", () => ({ api: { request: (path: string, init?: RequestInit) => mockApi.request(path, init) } }));
jest.mock("@/data/build-info", () => ({ buildInfo: () => ({ version: "0.3.0" }) }));

const answer = (minimum: string) => ({ min_supported_mobile_version: minimum, mobile_flags: {}, unichat_stores: {} });

async function returnToForeground() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}

afterEach(() => focusManager.setFocused(undefined));

it("still checks the minimum on every return to the foreground after a sign-out", async () => {
  mockApi.request.mockResolvedValue(answer(""));
  const { queryClient } = await render(
    <UpdateGate>
      <Text>app</Text>
    </UpdateGate>,
  );
  expect(await screen.findByText("app")).toBeOnTheScreen();

  await act(async () => clearAccountCache(queryClient));
  // The server raises the minimum while the phone is signed out.
  mockApi.request.mockResolvedValue(answer("0.4.0"));
  await returnToForeground();

  expect(await screen.findByRole("header", { name: viText("mobile.update.title") })).toBeOnTheScreen();
  expect(screen.queryByText("app")).toBeNull();
});
