// scripts/mobile-a11y-audit.mjs reads uiautomator's dump the way TalkBack and
// a thumb meet the screen: every control of the app named, and 48 dp a side.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditHierarchy, boundsSize, parseDensity, parseHierarchy, spokenName } from "./mobile-a11y-audit.mjs";

const PKG = "com.uniworkos.chat";
const node = (attrs, children = "") => {
  const text = Object.entries({ package: PKG, enabled: "true", clickable: "false", text: "", "content-desc": "", ...attrs })
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return children ? `<node ${text}>${children}</node>` : `<node ${text} />`;
};
const screen = (...nodes) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${nodes.join("")}</hierarchy>`;

describe("mobile a11y audit", () => {
  it("reads the tree, sizes and densities uiautomator and wm give", () => {
    const tree = parseHierarchy(screen(node({ class: "a" }, node({ class: "b" }) + node({ class: "c" }))));
    assert.equal(tree.children[0].attrs.class, "a");
    assert.deepEqual(tree.children[0].children.map((child) => child.attrs.class), ["b", "c"]);
    assert.deepEqual(boundsSize("[0,10][132,142]"), { width: 132, height: 132 });
    assert.equal(boundsSize("junk"), null);
    assert.equal(boundsSize(undefined), null);
    assert.equal(parseDensity("Physical density: 420\n"), 420 / 160);
    assert.equal(parseDensity("Physical density: 420\nOverride density: 480\n"), 3);
    assert.equal(parseDensity("nothing"), null);
    // A stray closing tag does not unbalance the tree.
    assert.equal(parseHierarchy("</node>" + screen(node({}))).children.length, 1);
  });

  it("names a control by its description, its text or the children it speaks for", () => {
    const [button] = parseHierarchy(screen(node({ clickable: "true" }, node({ text: "Đăng" }) + node({ text: "nhập" })))).children;
    assert.equal(spokenName(button), "Đăng nhập");
    const [described] = parseHierarchy(screen(node({ clickable: "true", "content-desc": "Gửi" }))).children;
    assert.equal(spokenName(described), "Gửi");
    // A clickable child is its own control: its words are not the parent's name.
    const [parent] = parseHierarchy(screen(node({ clickable: "true" }, node({ clickable: "true", text: "Trong" })))).children;
    assert.equal(spokenName(parent), "");
  });

  it("passes a named control of 48 dp, and flags an unnamed or small one of the app only", () => {
    const xml = screen(
      node({ clickable: "true", bounds: "[0,0][144,144]", "content-desc": "Đăng nhập" }),
      node({ clickable: "true", bounds: "[0,0][144,144]" }),
      node({ "long-clickable": "true", bounds: "[0,0][300,99]", text: "Bình" }),
      node({ clickable: "true", bounds: "[0,0][10,10]", package: "com.android.systemui" }),
      node({ clickable: "true", bounds: "[0,0][10,10]", enabled: "false", text: "x" }),
      node({ clickable: "true", bounds: "[0,0][0,0]" }),
      node({ clickable: "true", bounds: "bad" }),
    );
    const issues = auditHierarchy(xml, { pkg: PKG, density: 3 });
    assert.deepEqual(
      issues.map((issue) => [issue.rule, issue.detail]),
      [
        ["name", "a control with no text or content description"],
        ["target", "Bình: 100 × 33 dp, under 48 dp"],
      ],
    );
    // A screen whose small controls are grown by hit slop is held to 44 dp of drawn size instead.
    assert.deepEqual(auditHierarchy(screen(node({ clickable: "true", bounds: "[0,0][132,132]", text: "OK" })), { pkg: PKG, density: 3, minDp: 44 }), []);
    assert.equal(auditHierarchy(screen(node({ clickable: "true", bounds: "[0,0][132,132]" })), { pkg: PKG, density: 3 })[1].detail, "unnamed: 44 × 44 dp, under 48 dp");
  });
});
