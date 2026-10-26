// The app's Text (text.tsx): its classes are the variant's, the surrounding
// TextClassContext's and its own, merged by tailwind-merge — once per distinct
// combination, then read back (audit nativewind-runtime-cost), with the cache
// bounded so one-off classes cannot grow it.
import { screen } from "@testing-library/react-native";
import * as utils from "@/lib/utils";
import { render } from "@/test/render";
import { Text, TextClassContext, textClassName } from "./text";

afterEach(() => jest.restoreAllMocks());

describe("Text", () => {
  it("merges the variant's, the context's and its own classes, the later winning", async () => {
    await render(
      <TextClassContext value="text-primary">
        <Text className="text-footnote">a</Text>
        <Text variant="h1">b</Text>
      </TextClassContext>,
    );
    const a = screen.getByText("a").props.className as string;
    expect(a).toContain("text-primary");
    expect(a).toContain("text-footnote");
    expect(a).not.toContain("text-body");
    expect(a).not.toContain("text-foreground");
    expect(screen.getByText("b").props.className).toContain("text-display-xl");
    expect(screen.getByText("b").props.role).toBe("heading");
  });

  it("merges a combination once and reads it back after, and forgets them all past its bound", () => {
    const cn = jest.spyOn(utils, "cn");
    const first = textClassName("default", undefined, "text-caption cache-probe");
    expect(textClassName("default", undefined, "text-caption cache-probe")).toBe(first);
    expect(cn).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 1000; n += 1) textClassName("muted", undefined, `one-off-${n}`);
    cn.mockClear();
    expect(textClassName("default", undefined, "text-caption cache-probe")).toBe(first);
    expect(cn).toHaveBeenCalledTimes(1);
  });
});
