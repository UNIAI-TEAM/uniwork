// The Maestro flows that open the app signed out wait for and assert what the sign-in screen draws: the cold-start
// smoke (maestro/flows/smoke-launch.yaml), the largest-text one (a11y-large-text-dark.yaml) and the start of the
// subflow every signed-in flow runs (maestro/subflows/sign-in.yaml). Maestro matches the whole text of an element
// against each pattern, on a device in whichever language it runs, and lib/maestro-flows.test.ts only knows that a
// pattern is some string of the app: "Sign in" is one, but the screen's button reads "Log in". This renders the
// sign-in screen in both languages and holds those flows' texts and ids to what it draws.
import fs from "node:fs";
import path from "node:path";
import { cleanup, screen } from "@testing-library/react-native";
import AuthLayout from "@/app/(auth)/_layout";
import Login from "@/app/(auth)/login";
import { useAuthStore } from "@/data/auth/store";
import { i18n } from "@/lib/i18n/singleton";
import { renderRoutes } from "@/test/route-render";

jest.unmock("expo-router");
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-apple-authentication", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: () => (
      <Pressable accessibilityRole="button" testID="apple-native-button">
        <Text>Apple</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/data/auth/flow", () => ({
  ...jest.requireActual("@/data/auth/flow"),
  signInOffer: jest.fn(async () => ({ apple: "native", google: "native" })),
}));

const ROUTES = { "(auth)/_layout": AuthLayout, "(auth)/login": Login };
const MAESTRO = path.resolve(__dirname, "../../maestro");

interface Selector {
  where: string;
  kind: "text" | "id";
  value: string;
}

/** A flow's text patterns (`visible: "…"`, `assertVisible: "…"`, `text: "…"`) and literal ids, line by line. */
function selectors(file: string): Selector[] {
  return fs
    .readFileSync(path.join(MAESTRO, file), "utf8")
    .split("\n")
    .flatMap((line, i): Selector[] => {
      const where = `${file}:${i + 1}`;
      const text = /^\s*-?\s*(?:visible|assertVisible|text):\s*"([^"]+)"\s*$/.exec(line)?.[1];
      if (text) return [{ where, kind: "text", value: text }];
      const id = /^\s*-?\s*id:\s*"?([A-Za-z0-9_-]+)"?\s*$/.exec(line)?.[1];
      return id ? [{ where, kind: "id", value: id }] : [];
    });
}

/** What a device's hierarchy shows of the rendered tree: each text element's whole text, labels and testIDs. */
function drawn(): { texts: string[]; ids: Set<string> } {
  const texts: string[] = [];
  const ids = new Set<string>();
  const textOf = (node: unknown): string => {
    if (typeof node === "string") return node;
    if (node === null || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) return "";
    return node.children.map(textOf).join("");
  };
  const visit = (node: unknown) => {
    if (node === null || typeof node !== "object") return;
    const props: Record<string, unknown> = "props" in node && node.props !== null && typeof node.props === "object" ? { ...node.props } : {};
    if ("type" in node && node.type === "Text") texts.push(textOf(node));
    if (typeof props.accessibilityLabel === "string") texts.push(props.accessibilityLabel);
    if (typeof props.testID === "string") ids.add(props.testID);
    if ("children" in node && Array.isArray(node.children)) node.children.forEach(visit);
  };
  const tree = screen.toJSON();
  (Array.isArray(tree) ? tree : [tree]).forEach(visit);
  return { texts, ids };
}

/** Selectors of `wanted` that the sign-in screen, rendered in `language`, does not draw. */
async function missingOnSignIn(language: "vi" | "en", wanted: Selector[]): Promise<string[]> {
  await i18n.changeLanguage(language);
  useAuthStore.setState({ user: null, isLoading: false });
  await renderRoutes(ROUTES, "/login");
  await screen.findByTestId("provider-buttons");
  const { texts, ids } = drawn();
  return wanted
    .filter(({ kind, value }) => {
      if (kind === "id") return !ids.has(value);
      const pattern = new RegExp(`^(?:${value})$`);
      return !texts.some((text) => pattern.test(text) || pattern.test(text.replace(/\n/g, " ")));
    })
    .map(({ where, value }) => `${language} ${where} ${value}`);
}

afterEach(async () => {
  await cleanup();
  await i18n.changeLanguage("vi");
  useAuthStore.setState({ user: null, isLoading: true });
  jest.useRealTimers();
});

describe("the flows that open the app signed out", () => {
  const smoke = [...selectors("flows/smoke-launch.yaml"), ...selectors("flows/a11y-large-text-dark.yaml")];
  // The subflow's first wait, and the native branch's fields; its other branch is an older build's and the web's.
  const subflow = selectors("subflows/sign-in.yaml");
  const signIn = [...subflow.filter(({ kind }) => kind === "text").slice(0, 1), ...subflow.filter(({ kind, value }) => kind === "id" && value.startsWith("login-"))];

  it("read selectors out of the flows", () => {
    expect(smoke.filter(({ kind }) => kind === "text").length).toBeGreaterThan(3);
    expect(smoke.filter(({ kind }) => kind === "id").length).toBeGreaterThan(3);
    expect(signIn.map(({ value }) => value)).toEqual(expect.arrayContaining(["login-email", "login-password"]));
  });

  it.each(["vi", "en"] as const)("find every text and id they look for on the sign-in screen, in %s", async (language) => {
    expect(await missingOnSignIn(language, [...smoke, ...signIn])).toEqual([]);
  });
});
