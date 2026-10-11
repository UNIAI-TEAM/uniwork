import { describe, expect, it } from "vitest";
import { OFFICE_MODULES } from "./frame-bundle.mjs";
import { assertFrameComplete, isProductionBuild } from "./frame-production.mjs";

const all = [...OFFICE_MODULES];

describe("isProductionBuild", () => {
  it("is true only for NODE_ENV=production", () => {
    expect(isProductionBuild({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionBuild({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionBuild({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionBuild({})).toBe(false);
  });
});

describe("assertFrameComplete", () => {
  it("passes a production build with all six modules pinned and installed", () => {
    expect(() => assertFrameComplete({ production: true, source: "https://x/dist-web.tar.gz", pinned: all, installed: all })).not.toThrow();
  });
  it("fails a production build with no source and nothing installed, naming the source and every module", () => {
    expect(() => assertFrameComplete({ production: true, source: undefined, pinned: all, installed: [] })).toThrow(
      /all of docs, pdf, markdown, html, slides, sheets.*docs, pdf, markdown, html, slides, sheets not installed and there is no frame source.*source.json.*OFFICE_FRAME_SOURCE/s,
    );
  });
  it("fails a production build whose source lacks some modules, naming only those", () => {
    const installed = all.filter((module) => module !== "sheets" && module !== "slides");
    expect(() => assertFrameComplete({ production: true, source: "/srv/dist-web", pinned: all, installed })).toThrow(
      /slides, sheets not installed: the frame source has no verified build of them/,
    );
    expect(() => assertFrameComplete({ production: true, source: "/srv/dist-web", pinned: all, installed: all.filter((m) => m !== "pdf") })).toThrow(/pdf not installed: .* of it/);
  });
  it("fails a production build with a module that has no pin", () => {
    const pinned = all.filter((module) => module !== "html");
    expect(() => assertFrameComplete({ production: true, source: "/srv/dist-web", pinned, installed: pinned })).toThrow(/no pin for html/);
  });
  it("fails a production build with no pin at all", () => {
    expect(() => assertFrameComplete({ production: true, source: "/srv/dist-web", pinned: [], installed: [] })).toThrow(/no pin for docs, pdf/);
  });
  it("never fails a development or test build, whatever is installed", () => {
    expect(() => assertFrameComplete({ production: false, source: undefined, pinned: all, installed: [] })).not.toThrow();
    expect(() => assertFrameComplete({ production: false, source: undefined, pinned: [], installed: [] })).not.toThrow();
  });
});
