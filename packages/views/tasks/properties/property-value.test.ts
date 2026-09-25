import { describe, expect, it } from "vitest";
import type { TaskProperty } from "@uniwork/core/types";
import { formatPropertyValue, propertyOptions, readPropertyValue } from "./property-value";

function property(overrides: Partial<TaskProperty> & { type: TaskProperty["type"] }): TaskProperty {
  return {
    id: "p1",
    organization_id: "o1",
    workspace_id: "w1",
    name: "Thuộc tính",
    description: "",
    config: {},
    position: 0,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const selectOptionsConfig = {
  options: [
    { value: "a", label: "Alpha", color: "#ff0000" },
    { value: "b", label: "Beta" },
  ],
};

describe("propertyOptions", () => {
  it("parses string options as value=label", () => {
    const p = property({ type: "select", config: { options: ["todo", "done"] } });
    expect(propertyOptions(p)).toEqual([
      { id: "todo", name: "todo" },
      { id: "done", name: "done" },
    ]);
  });

  it("parses object options with value/label and optional color", () => {
    const p = property({ type: "select", config: selectOptionsConfig });
    expect(propertyOptions(p)).toEqual([
      { id: "a", name: "Alpha", color: "#ff0000" },
      { id: "b", name: "Beta" },
    ]);
  });

  it("falls back value to id ?? name and label to name ?? value", () => {
    const p = property({
      type: "select",
      config: { options: [{ id: "x1", name: "X label" }, { name: "y1" }] },
    });
    expect(propertyOptions(p)).toEqual([
      { id: "x1", name: "X label" },
      { id: "y1", name: "y1" },
    ]);
  });

  it("drops junk entries: non-string value/label, non-object, missing config", () => {
    const p = property({
      type: "select",
      config: { options: [null, 5, {}, { value: 5, label: "n" }, { value: "ok", label: 9 }] },
    });
    expect(propertyOptions(p)).toEqual([]);
  });

  it("returns [] when config.options is not an array", () => {
    expect(propertyOptions(property({ type: "select", config: {} }))).toEqual([]);
    expect(propertyOptions(property({ type: "select", config: { options: "nope" } }))).toEqual([]);
  });

  it("ignores a non-string color", () => {
    const p = property({
      type: "select",
      config: { options: [{ value: "a", label: "A", color: 5 }] },
    });
    expect(propertyOptions(p)).toEqual([{ id: "a", name: "A" }]);
  });
});

describe("readPropertyValue", () => {
  it("text: non-empty string is valid, everything else is undefined", () => {
    const p = property({ type: "text" });
    expect(readPropertyValue(p, "hello")).toBe("hello");
    expect(readPropertyValue(p, "")).toBeUndefined();
    expect(readPropertyValue(p, 5)).toBeUndefined();
    expect(readPropertyValue(p, undefined)).toBeUndefined();
  });

  it("url: valid http(s) URL is valid, everything else is undefined", () => {
    const p = property({ type: "url" });
    expect(readPropertyValue(p, "https://uniwork.app")).toBe("https://uniwork.app");
    expect(readPropertyValue(p, "http://uniwork.app")).toBe("http://uniwork.app");
    expect(readPropertyValue(p, "not a url")).toBeUndefined();
    expect(readPropertyValue(p, "ftp://uniwork.app")).toBeUndefined();
    expect(readPropertyValue(p, "")).toBeUndefined();
  });

  it("number: number or numeric string (comma as decimal separator), else undefined", () => {
    const p = property({ type: "number" });
    expect(readPropertyValue(p, 5)).toBe(5);
    expect(readPropertyValue(p, "5")).toBe(5);
    expect(readPropertyValue(p, "5,5")).toBe(5.5);
    expect(readPropertyValue(p, "")).toBeUndefined();
    expect(readPropertyValue(p, "abc")).toBeUndefined();
    expect(readPropertyValue(p, Number.NaN)).toBeUndefined();
  });

  it("select: non-empty string is valid, else undefined", () => {
    const p = property({ type: "select", config: selectOptionsConfig });
    expect(readPropertyValue(p, "a")).toBe("a");
    expect(readPropertyValue(p, "")).toBeUndefined();
    expect(readPropertyValue(p, 5)).toBeUndefined();
  });

  it("multi_select: array of non-empty strings, [] when nothing valid remains", () => {
    const p = property({ type: "multi_select", config: selectOptionsConfig });
    expect(readPropertyValue(p, ["a", "b"])).toEqual(["a", "b"]);
    expect(readPropertyValue(p, ["a", 5, ""])).toEqual(["a"]);
    expect(readPropertyValue(p, [])).toBeUndefined();
    expect(readPropertyValue(p, [5, ""])).toBeUndefined();
    expect(readPropertyValue(p, "not-array")).toBeUndefined();
  });

  it("date: YYYY-MM-DD calendar-valid string, else undefined", () => {
    const p = property({ type: "date" });
    expect(readPropertyValue(p, "2026-09-16")).toBe("2026-09-16");
    expect(readPropertyValue(p, "2026-13-40")).toBeUndefined();
    expect(readPropertyValue(p, "not-a-date")).toBeUndefined();
    expect(readPropertyValue(p, "")).toBeUndefined();
  });

  it("checkbox: boolean only, else undefined", () => {
    const p = property({ type: "checkbox" });
    expect(readPropertyValue(p, true)).toBe(true);
    expect(readPropertyValue(p, false)).toBe(false);
    expect(readPropertyValue(p, "true")).toBeUndefined();
    expect(readPropertyValue(p, undefined)).toBeUndefined();
  });
});

describe("formatPropertyValue", () => {
  it("text/url: the string itself, '' when empty", () => {
    const text = property({ type: "text" });
    expect(formatPropertyValue(text, "Hello", "vi")).toBe("Hello");
    expect(formatPropertyValue(text, "", "vi")).toBe("");
    expect(formatPropertyValue(text, undefined, "vi")).toBe("");

    const url = property({ type: "url" });
    expect(formatPropertyValue(url, "https://uniwork.app", "vi")).toBe("https://uniwork.app");
    expect(formatPropertyValue(url, "not a url", "vi")).toBe("");
  });

  it("number: locale-formatted, '' when invalid", () => {
    const p = property({ type: "number" });
    expect(formatPropertyValue(p, 1234.5, "vi-VN")).toBe(new Intl.NumberFormat("vi-VN").format(1234.5));
    expect(formatPropertyValue(p, "abc", "vi-VN")).toBe("");
  });

  it("select: option name when known, raw id when the option is missing, '' when unset", () => {
    const p = property({ type: "select", config: selectOptionsConfig });
    expect(formatPropertyValue(p, "a", "vi")).toBe("Alpha");
    expect(formatPropertyValue(p, "unknown-id", "vi")).toBe("unknown-id");
    expect(formatPropertyValue(p, undefined, "vi")).toBe("");
  });

  it("multi_select: option names joined, raw id for unknown members, '' when unset", () => {
    const p = property({ type: "multi_select", config: selectOptionsConfig });
    expect(formatPropertyValue(p, ["a", "b"], "vi")).toBe("Alpha, Beta");
    expect(formatPropertyValue(p, ["a", "z"], "vi")).toBe("Alpha, z");
    expect(formatPropertyValue(p, [], "vi")).toBe("");
  });

  it("date: locale-formatted day/month/year, '' when invalid", () => {
    const p = property({ type: "date" });
    const expected = new Intl.DateTimeFormat("vi", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(2026, 8, 16),
    );
    expect(formatPropertyValue(p, "2026-09-16", "vi")).toBe(expected);
    expect(formatPropertyValue(p, "not-a-date", "vi")).toBe("");
  });

  it("checkbox: a check mark when true, '' otherwise", () => {
    const p = property({ type: "checkbox" });
    expect(formatPropertyValue(p, true, "vi")).toBe("✓");
    expect(formatPropertyValue(p, false, "vi")).toBe("");
    expect(formatPropertyValue(p, undefined, "vi")).toBe("");
  });
});
