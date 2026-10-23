import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrgMember } from "@uniwork/core/types/people";
import { wrap } from "../../test/api-mock";
import { TransferCandidateField, candidateLabel } from "./transfer-owner-fields";

const an1: OrgMember = { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "admin", created_at: "" };
const an2: OrgMember = { user_id: "u3", email: "an.nguyen@acme.vn", display_name: "Nguyễn Văn An", role: "member", created_at: "" };
const binh: OrgMember = { user_id: "u4", email: "binh@acme.vn", display_name: "Trần Bình", role: "member", created_at: "" };
const noName: OrgMember = { user_id: "u5", email: "ghost@acme.vn", display_name: "", role: "member", created_at: "" };

function field(props: Partial<Parameters<typeof TransferCandidateField>[0]> = {}) {
  return render(
    wrap(
      <TransferCandidateField id="target" candidates={[an1, an2, binh]} value="" onValueChange={() => {}} {...props} />,
    ),
  );
}

describe("candidateLabel", () => {
  it("adds the email only when another candidate carries the same name", () => {
    const all = [an1, an2, binh, noName];
    expect(candidateLabel(an1, all)).toBe("Nguyễn Văn An (an@acme.vn)");
    expect(candidateLabel(binh, all)).toBe("Trần Bình");
    expect(candidateLabel(noName, all)).toBe("ghost@acme.vn");
  });
});

describe("TransferCandidateField", () => {
  it("tells two members with the same name apart by their email", async () => {
    field();
    fireEvent.click(screen.getByRole("combobox", { name: "Chủ sở hữu mới" }));
    const listbox = await screen.findByRole("listbox");
    // Every option carries its email as secondary text, ambiguous or not.
    expect(within(listbox).getByRole("option", { name: "Nguyễn Văn An an@acme.vn" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Nguyễn Văn An an.nguyen@acme.vn" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Trần Bình binh@acme.vn" })).toBeInTheDocument();
  });

  it("names the chosen member with the email when the name alone is ambiguous", () => {
    field({ value: "u3" });
    expect(screen.getByRole("combobox", { name: "Chủ sở hữu mới" })).toHaveTextContent("Nguyễn Văn An (an.nguyen@acme.vn)");
  });

  it("names the chosen member by name alone when nobody shares it", () => {
    field({ value: "u4" });
    const combobox = screen.getByRole("combobox", { name: "Chủ sở hữu mới" });
    expect(combobox).toHaveTextContent("Trần Bình");
    expect(combobox).not.toHaveTextContent("binh@acme.vn");
  });

  it("cannot be opened when nobody can receive the organization, and says why", () => {
    field({ candidates: [], empty: "Chưa có thành viên nào đang hoạt động để nhận quyền." });
    const combobox = screen.getByRole("combobox", { name: "Chủ sở hữu mới" });
    expect(combobox).toBeDisabled();
    fireEvent.click(combobox);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Chưa có thành viên nào đang hoạt động để nhận quyền.");
  });

  it("holds the select's place with a skeleton until the first members arrive", () => {
    field({ candidates: [], loading: true });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải danh sách thành viên…");
  });

  it("offers the members already read while further pages load", () => {
    field({ loading: true });
    expect(screen.getByRole("combobox", { name: "Chủ sở hữu mới" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải danh sách thành viên…");
  });

  it("cannot be opened when the members could not be read", () => {
    field({ candidates: [], isError: true, onRetry: () => {} });
    expect(screen.getByRole("combobox", { name: "Chủ sở hữu mới" })).toBeDisabled();
    expect(screen.getByText("Không tải được danh sách thành viên để chọn.")).toBeInTheDocument();
  });
});
