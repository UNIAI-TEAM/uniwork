import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XlsxFormulaHintsList, useFormulaHints, XLSX_FORMULA_HINTS_MAX } from "./formula-hints";
import { matchFunctions } from "./function-catalog";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function stringPaths(dictionary: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else walk(value, path);
    }
  };
  walk(dictionary, "");
  return paths.sort();
}

/** A harness that drives the hook exactly like the editor's formula bar. */
function Harness({ onComplete = vi.fn() }: { onComplete?: (value: string, caret: number) => void }) {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const hints = useFormulaHints({ draft, caret, onComplete });
  return (
    <div>
      <input
        data-testid="draft"
        value={draft}
        role={hints.inputProps.role}
        aria-expanded={hints.inputProps["aria-expanded"]}
        aria-controls={hints.inputProps["aria-controls"]}
        aria-activedescendant={hints.inputProps["aria-activedescendant"]}
        onChange={(event) => {
          setDraft(event.target.value);
          setCaret(event.target.value.length);
        }}
        onKeyDown={(event) => {
          if (hints.handleKeyDown(event)) return;
        }}
      />
      {hints.open ? (
        <XlsxFormulaHintsList items={hints.items} activeIndex={hints.activeIndex} onSelect={hints.select} />
      ) : null}
    </div>
  );
}

const type = (value: string) => {
  const input = screen.getByTestId("draft");
  fireEvent.change(input, { target: { value } });
};

describe("XlsxFormulaHintsList", () => {
  it("opens on a name prefix and lists matching functions with signatures", () => {
    render(<Harness />);
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
    type("=SU");
    const list = screen.getByTestId("xlsx-formula-hints");
    expect(list).toHaveAccessibleName(lookup(viLocale, "office.xlsx.formulas.hints.label"));
    expect(screen.getByTestId("xlsx-formula-hint-SUM")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-formula-hint-SUMIF")).toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-formula-hint-AVERAGE")).not.toBeInTheDocument();
    expect(screen.getByTestId("xlsx-formula-hint-SUM")).toHaveAttribute("aria-selected", "true");
  });

  it("stays closed for a value, a complete call and an unmatched name", () => {
    render(<Harness />);
    type("=123");
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
    type("=SUM(");
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
    type("=ZZZ");
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
  });

  it("bounds the popup to the readable row count", () => {
    render(<Harness />);
    type("=S");
    const rows = matchFunctions("S").slice(0, XLSX_FORMULA_HINTS_MAX);
    expect(screen.getAllByRole("option")).toHaveLength(rows.length);
  });

  it("completes with Enter, wrapping the arrow keys, and keeps the input focused", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    type("=SU");
    const input = screen.getByTestId("draft");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("xlsx-formula-hint-SUMIF")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByTestId("xlsx-formula-hint-SUM")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onComplete).toHaveBeenCalledWith("=SUM(", 5);
  });

  it("completes with Tab and closes with Escape", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    type("=AVER");
    fireEvent.keyDown(screen.getByTestId("draft"), { key: "Tab" });
    expect(onComplete).toHaveBeenCalledWith("=AVERAGE(", 9);

    type("=SU");
    expect(screen.getByTestId("xlsx-formula-hints")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("draft"), { key: "Escape" });
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
  });

  it("completes from a pointer pick without letting the input blur", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    type("=COUN");
    const option = screen.getByTestId("xlsx-formula-hint-COUNT");
    fireEvent.mouseDown(option);
    expect(onComplete).toHaveBeenCalledWith("=COUNT(", 7);
  });

  it("keeps the hints subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.formulas"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
