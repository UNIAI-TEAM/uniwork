import { afterEach, describe, expect, it } from "vitest";
import { dimChromeAround } from "./frame-modal-chrome";

afterEach(() => { document.body.innerHTML = ""; });

describe("dimChromeAround", () => {
  it("dims and inerts everything around the kept element, and restores it exactly", () => {
    document.body.innerHTML = `
      <aside id="sidebar" style="filter: grayscale(1)"></aside>
      <main id="main">
        <header id="header"></header>
        <div id="frame"><iframe id="inner"></iframe></div>
      </main>
      <div id="already" inert></div>`;
    const byId = (id: string) => document.getElementById(id)!;
    const undo = dimChromeAround(byId("frame"));
    for (const id of ["sidebar", "header"]) {
      expect(byId(id).hasAttribute("inert"), id).toBe(true);
      expect(byId(id).style.filter, id).toBe("brightness(0.6) saturate(0.8)");
      expect(byId(id).hasAttribute("data-office-frame-modal-dimmed"), id).toBe(true);
    }
    // The frame's own path stays live, and an element that was inert before is not claimed.
    for (const id of ["frame", "inner", "main"]) expect(byId(id).hasAttribute("inert"), id).toBe(false);
    expect(byId("already").hasAttribute("data-office-frame-modal-dimmed")).toBe(false);

    undo();
    expect(byId("sidebar").hasAttribute("inert")).toBe(false);
    expect(byId("sidebar").style.filter).toBe("grayscale(1)");
    expect(byId("header").style.filter).toBe("");
    expect(byId("header").hasAttribute("data-office-frame-modal-dimmed")).toBe(false);
    expect(byId("already").hasAttribute("inert")).toBe(true);
  });
});
