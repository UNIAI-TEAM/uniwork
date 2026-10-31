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
    const { issues, unmeasured } = auditHierarchy(xml, { pkg: PKG, density: 3 });
    assert.deepEqual(unmeasured, []);
    assert.deepEqual(
      issues.map((issue) => [issue.rule, issue.detail]),
      [
        ["name", "a control with no text or content description"],
        ["target", "Bình: 100 × 33 dp, under 48 dp"],
      ],
    );
    // A screen whose small controls are grown by hit slop is held to 44 dp of drawn size instead.
    assert.deepEqual(auditHierarchy(screen(node({ clickable: "true", bounds: "[0,0][132,132]", text: "OK" })), { pkg: PKG, density: 3, minDp: 44 }).issues, []);
    assert.equal(auditHierarchy(screen(node({ clickable: "true", bounds: "[0,0][132,132]" })), { pkg: PKG, density: 3 }).issues[1].detail, "unnamed: 44 × 44 dp, under 48 dp");
  });

  // android-smoke, 320 × 640 at mdpi: the sign-in screen's browser button (48 dp min) showed 42 dp of itself above the
  // scroll view's bottom edge, and uiautomator and Maestro both gave those 42 as its bounds.
  it("leaves a control cut by the scroll view's edge unmeasured, along the way that view scrolls only", () => {
    const scroll = (cls, children) => node({ class: cls, scrollable: "true", bounds: "[0,0][320,616]" }, children);
    const button = (bounds, text) => node({ clickable: "true", class: "android.widget.Button", bounds, text });
    const xml = screen(
      scroll(
        "android.widget.ScrollView",
        button("[24,574][296,616]", "Đăng nhập bằng trình duyệt") +
          button("[24,0][296,30]", "Đăng nhập") +
          button("[24,300][296,330]", "Quên mật khẩu") +
          button("[0,400][30,460]", "Ẩn") +
          node({ class: "android.view.ViewGroup" }, button("[24,590][30,616]", "·")),
      ),
      node(
        { class: "android.widget.HorizontalScrollView", scrollable: "true", bounds: "[0,580][320,640]" },
        button("[300,580][320,640]", "Tiếp") + button("[0,610][40,640]", "Lùi"),
      ),
      button("[24,600][296,640]", "Ngoài"),
    );
    const { issues, unmeasured } = auditHierarchy(xml, { pkg: PKG, density: 1 });
    assert.deepEqual(
      unmeasured.map((control) => control.detail),
      [
        "Đăng nhập bằng trình duyệt: 272 × 42 dp, under 48 dp as drawn, cut by its scroll view",
        "Đăng nhập: 272 × 30 dp, under 48 dp as drawn, cut by its scroll view",
        "Tiếp: 20 × 60 dp, under 48 dp as drawn, cut by its scroll view",
      ],
    );
    assert.deepEqual(
      issues.map((issue) => issue.detail),
      [
        // Whole and still short: a real one.
        "Quên mật khẩu: 272 × 30 dp, under 48 dp",
        // Flush with a vertical scroll view's side: nothing scrolls it there.
        "Ẩn: 30 × 60 dp, under 48 dp",
        // Cut at the bottom (a nested view inherits its scroll view), but too narrow as well, which no cut explains.
        "·: 6 × 26 dp, under 48 dp",
        // Cut at its start by a sideways scroll, but short too, which a sideways scroll cannot cut.
        "Lùi: 40 × 30 dp, under 48 dp",
        // Outside any scroll view, nothing cuts it.
        "Ngoài: 272 × 40 dp, under 48 dp",
      ],
    );
  });
});
