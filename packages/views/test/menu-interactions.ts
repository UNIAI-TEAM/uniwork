// Chọn mục trong menu Base UI bằng chuột hoặc bàn phím, dùng chung cho test views.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

export type Via = "mouse" | "keyboard";

function focusedText(): string | undefined {
  return document.activeElement?.textContent?.trim();
}

/** Moves the highlight with ArrowDown until `name` is focused, then presses Enter. */
function pressEnterOn(name: string) {
  for (let i = 0; i < 12; i += 1) {
    if (focusedText() === name) break;
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
  }
  expect(focusedText()).toBe(name);
  // Base UI turns Enter on a highlighted item into item.click().
  fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
}

async function waitForFocusIn(menu: HTMLElement) {
  await waitFor(() =>
    expect(menu.contains(document.activeElement) || document.activeElement === menu).toBe(true),
  );
}

export async function chooseItem(menu: HTMLElement, name: string, via: Via) {
  if (via === "mouse") {
    fireEvent.click(within(menu).getByRole("menuitem", { name }));
    return;
  }
  await waitForFocusIn(menu);
  pressEnterOn(name);
}

export async function chooseInSubmenu(
  menu: HTMLElement,
  trigger: string,
  option: string,
  via: Via,
) {
  if (via === "mouse") {
    fireEvent.click(within(menu).getByRole("menuitem", { name: trigger }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
    return;
  }
  await waitForFocusIn(menu);
  for (let i = 0; i < 12; i += 1) {
    if (focusedText() === trigger) break;
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
  }
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
  await screen.findByRole("menuitemradio", { name: option });
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio"),
  );
  pressEnterOn(option);
}
