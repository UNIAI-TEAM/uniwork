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

/**
 * Opens the shared assignee picker from a row menu and picks `option`, by a
 * click or by typing into its search and pressing Enter. Clicks the search box
 * first so a test also sees whether a click inside the picker reaches the row.
 */
export async function chooseAssignee(menu: HTMLElement, option: string, via: Via) {
  await chooseItem(menu, "Đổi người phụ trách", via);
  const search = await screen.findByPlaceholderText("Tìm thành viên hoặc agent");
  const row = await screen.findByRole("button", { name: option });
  fireEvent.click(search);
  if (via === "mouse") {
    fireEvent.click(row);
    return;
  }
  fireEvent.change(search, { target: { value: option } });
  fireEvent.keyDown(search, { key: "Enter" });
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
