import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Card } from "./card";
import { InputGroup } from "./input-group";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { Textarea } from "./textarea";
import { TimeInput } from "./time-input";
import { Toggle } from "./toggle";

describe("shared radius contract", () => {
  it("keeps default controls on the 10px control radius", () => {
    render(
      <>
        <Button>Button</Button>
        <Input aria-label="Input" />
        <Textarea aria-label="Textarea" />
        <InputGroup data-testid="input-group" />
        <Toggle>Toggle</Toggle>
        <Select items={[{ value: "one", label: "One" }]} value="one">
          <SelectTrigger aria-label="Select">
            <SelectValue />
          </SelectTrigger>
        </Select>
        <Tabs defaultValue="one">
          <TabsList aria-label="Tabs">
            <TabsTrigger value="one">One</TabsTrigger>
          </TabsList>
        </Tabs>
      </>,
    );

    const controls = [
      screen.getByRole("button", { name: "Button" }),
      screen.getByRole("textbox", { name: "Input" }),
      screen.getByRole("textbox", { name: "Textarea" }),
      screen.getByTestId("input-group"),
      screen.getByRole("button", { name: "Toggle" }),
      screen.getByRole("combobox", { name: "Select" }),
      screen.getByRole("tablist", { name: "Tabs" }),
    ];

    for (const control of controls) {
      expect(control).toHaveClass("rounded-control");
      expect(control).not.toHaveClass("rounded-lg");
    }
  });

  it("keeps cards one step above controls instead of using overlay radius", () => {
    render(<Card data-testid="card" />);

    expect(screen.getByTestId("card")).toHaveClass("rounded-lg");
    expect(screen.getByTestId("card")).not.toHaveClass("rounded-xl");
  });

  it("uses a quiet dark surface for field fills while retaining the input border", () => {
    render(
      <>
        <Input aria-label="Input fill" />
        <Textarea aria-label="Textarea fill" />
        <InputGroup data-testid="input-group-fill" />
        <TimeInput
          value="17:00"
          onChange={() => undefined}
          hourLabel="Hour"
          minuteLabel="Minute"
        />
        <Select items={[{ value: "one", label: "One" }]} value="one">
          <SelectTrigger aria-label="Select fill">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </>,
    );

    const fields = [
      screen.getByRole("textbox", { name: "Input fill" }),
      screen.getByRole("textbox", { name: "Textarea fill" }),
      screen.getByTestId("input-group-fill"),
      screen.getByRole("presentation"),
      screen.getByRole("combobox", { name: "Select fill" }),
    ];

    for (const field of fields) {
      expect(field).toHaveClass("border-input", "dark:bg-surface-hover/60");
      expect(field).not.toHaveClass("dark:bg-input/30");
    }
  });
});
