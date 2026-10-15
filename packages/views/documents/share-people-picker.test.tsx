import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { OrgMember } from "@uniwork/core/types/people";
import { SHARE_PEOPLE_MAX, SharePeoplePicker, type useSharePeople } from "./share-people-picker";

const { t } = initI18n();

const member = (i: number, name: string): OrgMember => ({
  user_id: `m${i}`,
  email: `m${i}@acme.vn`,
  display_name: name,
  role: "member",
  created_at: "",
});

function people(ids: string[], change = vi.fn()): ReturnType<typeof useSharePeople> {
  return { ids, change, submit: vi.fn(), isPending: false };
}

function openWith(query: string) {
  const input = screen.getByRole("combobox");
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.change(input, { target: { value: query } });
}

describe("SharePeoplePicker", () => {
  it("finds people without diacritics or by email and marks who already has access", async () => {
    render(
      <SharePeoplePicker
        id="p"
        members={[member(1, "Bình"), member(2, "Đức"), member(3, "Chi")]}
        shares={[{ principal_type: "user", principal_id: "m2", active: true }]}
        people={people([])}
      />,
    );

    openWith("binh");
    expect(await screen.findByRole("option", { name: /Bình/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Chi/ })).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "duc" } });
    // Already shared stays selectable: the server replaces the level.
    const duc = await screen.findByRole("option", { name: /Đức/ });
    expect(duc).toHaveTextContent(t("documents.share.people_already_shared"));
    expect(duc).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "m3@acme" } });
    expect(await screen.findByRole("option", { name: /Chi/ })).toBeInTheDocument();
  });

  it("adds a picked person to the selection", async () => {
    const change = vi.fn();
    render(<SharePeoplePicker id="p" members={[member(1, "Bình"), member(2, "Chi")]} shares={[]} people={people(["m1"], change)} />);

    openWith("Chi");
    fireEvent.click(await screen.findByRole("option", { name: /Chi/ }));
    expect(change).toHaveBeenCalledWith(["m1", "m2"]);
  });

  it("describes the count as plain text and keeps the live region silent below the cap", () => {
    render(<SharePeoplePicker id="p" members={[member(1, "Bình"), member(2, "Chi")]} shares={[]} people={people(["m1", "m2"])} />);

    const count = t("documents.share.people_selected", { count: 2 });
    expect(screen.getByText(count)).not.toHaveAttribute("role");
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(count);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("removes the last chip on Backspace in an empty input and announces it", () => {
    const change = vi.fn();
    render(<SharePeoplePicker id="p" members={[member(1, "Bình"), member(2, "Chi")]} shares={[]} people={people(["m1", "m2"], change)} />);

    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.change(input, { target: { value: "bi" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(change).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(change).toHaveBeenCalledWith(["m1"]);
    expect(input).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(t("documents.share.people_removed", { name: "Chi" }));
  });

  it("names the chevron button", () => {
    render(<SharePeoplePicker id="p" members={[member(1, "Bình")]} shares={[]} people={people([])} />);

    expect(screen.getByRole("button", { name: t("documents.share.people_toggle") })).toBeInTheDocument();
  });

  it("bounds the chosen list with its own scroll so Level and Share stay in reach", () => {
    const members = Array.from({ length: SHARE_PEOPLE_MAX }, (_, i) => member(i, `Người ${i}`));
    render(<SharePeoplePicker id="p" members={members} shares={[]} people={people(members.map((m) => m.user_id))} />);

    const list = screen.getByRole("list", { name: t("documents.share.people_chosen") });
    expect(list.className).toMatch(/(^|\s)max-h-/);
    expect(list).toHaveClass("overflow-y-auto");
    // The count / cap hint sits outside the scroll box, so it stays visible.
    const hint = document.getElementById("p-hint");
    expect(hint).toHaveTextContent(t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX }));
    expect(list).not.toContainElement(hint);
  });

  it("gives the popup room and keeps the whole name, truncating only the email", async () => {
    const name = "Nguyễn Thị Thanh Hương Giang";
    render(<SharePeoplePicker id="p" members={[member(1, name), member(2, "Nguyễn Thị Thanh Hà")]} shares={[]} people={people([])} />);

    openWith("nguyen");
    const option = await screen.findByRole("option", { name: new RegExp(name) });
    const nameEl = screen.getByText(name);
    expect(option).toContainElement(nameEl);
    expect(nameEl.className).not.toMatch(/truncate/);
    expect(screen.getByText("m1@acme.vn")).toHaveClass("truncate");
    // The popup is at least as wide as the field and wide enough to read names.
    const popup = document.querySelector<HTMLElement>('[data-slot="combobox-content"]');
    expect(popup?.className).toContain("--anchor-width");
    expect(popup?.className).toMatch(/min-w-\[max\(/);
  });

  it("disables unpicked people at the 50-person cap and says why", async () => {
    const members = Array.from({ length: SHARE_PEOPLE_MAX + 1 }, (_, i) => member(i, `Người ${i}`));
    const picked = members.slice(0, SHARE_PEOPLE_MAX).map((m) => m.user_id);
    render(<SharePeoplePicker id="p" members={members} shares={[]} people={people(picked)} />);

    expect(screen.getByRole("status")).toHaveTextContent(t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX }));
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(
      t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX }),
    );
    // A picked person can still be removed at the cap.
    expect(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Người 0" }) })).toBeEnabled();
    openWith(`Người ${SHARE_PEOPLE_MAX}`);
    expect(await screen.findByRole("option", { name: new RegExp(`Người ${SHARE_PEOPLE_MAX}`) })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
