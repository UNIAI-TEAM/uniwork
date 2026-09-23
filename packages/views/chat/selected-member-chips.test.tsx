import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { wrap } from "../test/api-mock";
import { SelectedMemberChips } from "./selected-member-chips";

beforeAll(() => {
  initI18n();
});

const people: ChatContact[] = [
  { user_id: "u1", email: "an@example.com", display_name: "An" },
  { user_id: "u2", email: "binh@example.com", display_name: "Binh" },
  { user_id: "u3", email: "chi@example.com", display_name: "Chi" },
];

function Harness({ onRemovedLast }: { onRemovedLast: () => void }) {
  const [members, setMembers] = useState(people);
  return (
    <SelectedMemberChips
      members={members}
      onRemove={(id) => setMembers((prev) => prev.filter((m) => m.user_id !== id))}
      onRemovedLast={onRemovedLast}
    />
  );
}

describe("SelectedMemberChips", () => {
  it("moves focus to the neighbouring chip after a removal, and out once none is left", () => {
    const onRemovedLast = vi.fn();
    render(wrap(<Harness onRemovedLast={onRemovedLast} />));

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn Binh" }));
    // The chip that took Binh's place.
    expect(screen.getByRole("button", { name: "Bỏ chọn Chi" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn Chi" }));
    // Chi was last in the row: the one before it.
    expect(screen.getByRole("button", { name: "Bỏ chọn An" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn An" }));
    expect(onRemovedLast).toHaveBeenCalledTimes(1);
  });
});
