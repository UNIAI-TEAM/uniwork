import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

it("forwards vertical orientation to the accessible tablist", () => {
  render(<Tabs orientation="vertical" defaultValue="tasks"><TabsList aria-label="Features"><TabsTrigger value="tasks">Tasks</TabsTrigger><TabsTrigger value="meetings">Meetings</TabsTrigger></TabsList><TabsContent value="tasks">Task list</TabsContent></Tabs>);
  expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
});
