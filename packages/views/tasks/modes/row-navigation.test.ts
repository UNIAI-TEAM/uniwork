import { afterEach, describe, expect, it } from "vitest";
import { isRowControlTarget } from "./row-navigation";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isRowControlTarget", () => {
  it.each([
    ["button", "<button><span data-hit>Mở</span></button>"],
    ["input", "<input data-hit />"],
    ["a", "<a href='#'><span data-hit>Liên kết</span></a>"],
    ["menuitem", "<div role='menuitem'><span data-hit>Xoá</span></div>"],
    ["menuitemradio", "<div role='menuitemradio'><span data-hit>Đang làm</span></div>"],
    ["menuitemcheckbox", "<div role='menuitemcheckbox'><span data-hit>Bug</span></div>"],
    ["option", "<div role='option'><span data-hit>An Nguyễn</span></div>"],
  ])("khớp khi đích nằm trong %s", (_role, html) => {
    const host = mount(html);
    expect(isRowControlTarget(host.querySelector("[data-hit]"))).toBe(true);
  });

  it("không khớp một ô bình thường của hàng", () => {
    const host = mount("<div role='row'><div role='cell'><span data-hit>Tiêu đề</span></div></div>");
    expect(isRowControlTarget(host.querySelector("[data-hit]"))).toBe(false);
  });

  it("không khớp khi đích không phải element", () => {
    expect(isRowControlTarget(null)).toBe(false);
    expect(isRowControlTarget(document)).toBe(false);
  });
});
