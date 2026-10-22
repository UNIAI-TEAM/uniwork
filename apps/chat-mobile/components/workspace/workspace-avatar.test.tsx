// A workspace's mark (workspace-avatar.tsx): its icon image (a server path made
// absolute against the API), else its emoji, else its letters on its own colour.
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { screen } from "@testing-library/react-native";
import { render } from "@/test/render";
import { WorkspaceAvatar } from "./workspace-avatar";

beforeEach(() => configureRuntime({ apiUrl: "https://api.example" }));
afterEach(() => resetRuntimeConfig());

const sourceOf = (name: string) => screen.getByLabelText(name).props.source as { uri?: string } | { uri?: string }[];
const uriOf = (name: string) => {
  const source = sourceOf(name);
  return Array.isArray(source) ? source[0]?.uri : source.uri;
};

describe("WorkspaceAvatar", () => {
  it("draws a server-relative icon from the API origin", async () => {
    await render(<WorkspaceAvatar name="Acme HQ" iconUrl="/files/icon.png" size={40} />);
    expect(uriOf("Acme HQ")).toBe("https://api.example/files/icon.png");
  });

  it("draws an absolute icon as it is", async () => {
    await render(<WorkspaceAvatar name="Acme HQ" iconUrl="https://cdn.example/i.png" />);
    expect(uriOf("Acme HQ")).toBe("https://cdn.example/i.png");
  });

  it("draws the emoji when there is no icon", async () => {
    await render(<WorkspaceAvatar name="Acme HQ" iconEmoji="🚀" />);
    expect(screen.getByText("🚀")).toBeOnTheScreen();
  });

  it("draws the letters otherwise, one or two of them", async () => {
    const { rerender } = await render(<WorkspaceAvatar name="Kinh Doanh" seed="ws1" />);
    expect(screen.getByText("KD")).toBeOnTheScreen();
    await rerender(<WorkspaceAvatar name="Acme" />);
    expect(screen.getByText("A")).toBeOnTheScreen();
  });
});
