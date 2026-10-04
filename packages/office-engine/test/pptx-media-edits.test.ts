// B8e (UNI-927) - media + SmartArt edit-builder tests (engine half).
//
// Vendored guard first: every op these builders can emit must exist in
// insert-ops.ts as `name: '<op>'`, and the SmartArt layout vocabulary must be
// the vendored union. Op objects are compared strictly (absent fields stay
// absent) and refusals branch on typed PptxEngineError codes.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMediaOps,
  EMU_PER_PX_96,
  MEDIA_KINDS,
  PptxEngineError,
  SMARTART_LAYOUT_NAMES,
  type MediaEdit,
  type MediaKind,
  type MediaPoster,
  type OpenedPptxLike,
  type PptxOp,
  type SmartArtLayoutName,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

const FIT = 960; // deck 9144000 EMU = 960px at 96 DPI -> scale 1
const EMU = (px: number): number => px * EMU_PER_PX_96;

/** Plain deck fixture: one slide - enough for slide-exists validation. */
const opened = (): OpenedPptxLike => ({
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [{ id: "s1", elements: [] }],
  },
});

const build = (edit: MediaEdit, deck: OpenedPptxLike = opened(), fit = FIT) =>
  buildMediaOps(deck, fit, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const field = <T,>(op: PptxOp | undefined, key: string): T => (op as Record<string, unknown>)[key] as T;
const bytesOf = (...values: number[]): Uint8Array => new Uint8Array(values);
const poster: MediaPoster = { bytes: bytesOf(1, 2, 3), ext: "png" };

describe("media vendored guard", () => {
  it("emits only op names registered in the vendored insert-ops source", () => {
    const insertOps = readVendored("pptx-ops/src/ops/insert-ops.ts");
    // The exact registry entries B8e binds to (insert-ops.ts:286, :264, :324).
    for (const op of ["addMedia", "addSmartArt", "addModel3d"]) {
      expect(insertOps).toContain("name: '" + op + "'");
    }
  });

  it("pins the media/smartart section to the vendored apply functions", () => {
    const insertOps = readVendored("pptx-ops/src/ops/insert-ops.ts");
    expect(insertOps).toContain("addMedia(ctx.opened, index, {");
    expect(insertOps).toContain("addSmartArt(ctx.opened, index, {");
    expect(insertOps).toContain("addModel3d(ctx.opened, index, {");
    // The engine modules the ops reach (never imported by this builder).
    const media = readVendored("pptx-engine/src/media-insert.ts");
    expect(media).toContain("export function addMedia(");
    expect(media).toContain("export function addModel3d(");
    const smartart = readVendored("pptx-engine/src/smartart.ts");
    expect(smartart).toContain("export function addSmartArt(");
  });

  it("MEDIA_KINDS matches the vendored kind union and SMARTART_LAYOUT_NAMES the vendored layout union", () => {
    const insertOps = readVendored("pptx-ops/src/ops/insert-ops.ts");
    expect(insertOps).toContain("op.kind !== 'video' && op.kind !== 'audio'");
    expect([...MEDIA_KINDS]).toEqual(["video", "audio"]);
    const layout = readVendored("pptx-engine/src/smartart-layout.ts");
    for (const name of SMARTART_LAYOUT_NAMES) expect(layout).toContain("'" + name + "'");
  });

  it("binds no embedded-font op (the vendored ops registry has none; engine-only capability)", () => {
    // Enumerate every registered op name across the vendored ops registry.
    const opsDir = join(REPO, "packages", "office-upstream", "upstream", "packages", "pptx-ops", "src", "ops");
    const files = readdirSync(opsDir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const names = files.flatMap((file) =>
      [...readFileSync(join(opsDir, file), "utf8").matchAll(/name: '([A-Za-z0-9]+)'/g)].map((m) => m[1]!),
    );
    expect(names).toContain("addMedia");
    // No op embeds fonts: none mentions "embedded"; the only font-related op is
    // setFont (run/character formatting, text-ops.ts), not font embedding.
    expect(names.filter((n) => /embedded/i.test(n))).toEqual([]);
    expect(names.filter((n) => /font/i.test(n))).toEqual(["setFont"]);
    // embedded-fonts.ts is a read/parse helper (no op), reached by the engine only.
    const embedded = readVendored("pptx-engine/src/embedded-fonts.ts");
    expect(embedded).toContain("export function listEmbeddedFonts(");
    expect(embedded).toContain("export function stripStaleEmbeddedFonts(");
  });
});

describe("add_media op building", () => {
  it("converts the px rect to EMU and passes kind/ext/bytes through", () => {
    const bytes = bytesOf(9, 8, 7);
    expect(
      build({
        op: "add_media",
        slideIndex: 0,
        kind: "video",
        ext: "mp4",
        bytes,
        xPx: 10,
        yPx: 20,
        wPx: 300,
        hPx: 150,
      }),
    ).toStrictEqual([
      {
        op: "addMedia",
        target: { slide: 0 },
        kind: "video",
        bytes,
        ext: "mp4",
        offset: { x: EMU(10), y: EMU(20), cx: EMU(300), cy: EMU(150) },
      },
    ]);
  });

  it("carries poster and name when given, and passes the byte references through", () => {
    const bytes = bytesOf(1);
    const posterBytes = bytesOf(2);
    const [op] = build({
      op: "add_media",
      slideIndex: 0,
      kind: "audio",
      ext: "mp3",
      bytes,
      xPx: 0,
      yPx: 0,
      wPx: 100,
      hPx: 50,
      poster: { bytes: posterBytes, ext: "jpg" },
      name: "Narration",
    });
    expect(op).toStrictEqual({
      op: "addMedia",
      target: { slide: 0 },
      kind: "audio",
      bytes,
      ext: "mp3",
      offset: { x: 0, y: 0, cx: EMU(100), cy: EMU(50) },
      name: "Narration",
      poster: { bytes: posterBytes, ext: "jpg" },
    });
    expect(field<Uint8Array>(op, "bytes")).toBe(bytes);
    expect(field<MediaPoster>(op, "poster").bytes).toBe(posterBytes);
  });

  it("omits optional keys when the edit does not set them", () => {
    const [op] = build({
      op: "add_media",
      slideIndex: 0,
      kind: "audio",
      ext: "wav",
      bytes: bytesOf(5),
      xPx: 0,
      yPx: 0,
      wPx: 10,
      hPx: 10,
    });
    expect(op).toStrictEqual({
      op: "addMedia",
      target: { slide: 0 },
      kind: "audio",
      bytes: bytesOf(5),
      ext: "wav",
      offset: { x: 0, y: 0, cx: EMU(10), cy: EMU(10) },
    });
    expect(Object.keys(op as Record<string, unknown>)).not.toContain("poster");
    expect(Object.keys(op as Record<string, unknown>)).not.toContain("name");
  });

  it("px->EMU follows makePxToEmu's fitWidth scale (canvas pixels, not device pixels)", () => {
    const [op] = build(
      {
        op: "add_media",
        slideIndex: 0,
        kind: "video",
        ext: "webm",
        bytes: bytesOf(1),
        xPx: 10,
        yPx: 0,
        wPx: 10,
        hPx: 10,
      },
      opened(),
      480,
    );
    // deck width 960px at 96 DPI scaled to 480 -> half scale -> 10px is 20 base px.
    expect(field<{ x: number }>(op, "offset").x).toBe(Math.round((10 / 0.5) * EMU_PER_PX_96));
  });
});

describe("add_smartart op building", () => {
  it("converts the px rect to EMU and passes layout + items through", () => {
    const items = ["Plan", "Build", "Ship"];
    expect(
      build({
        op: "add_smartart",
        slideIndex: 0,
        layout: "process",
        items,
        xPx: 5,
        yPx: 15,
        wPx: 400,
        hPx: 120,
      }),
    ).toStrictEqual([
      {
        op: "addSmartArt",
        target: { slide: 0 },
        layout: "process",
        items,
        offset: { x: EMU(5), y: EMU(15), cx: EMU(400), cy: EMU(120) },
      },
    ]);
  });

  it("keeps the items array by reference (the engine lays out 1..8 nodes)", () => {
    const items = ["A", "B"];
    const [op] = build({
      op: "add_smartart",
      slideIndex: 0,
      layout: "list",
      items,
      xPx: 0,
      yPx: 0,
      wPx: 100,
      hPx: 100,
    });
    expect(field<string[]>(op, "items")).toBe(items);
  });

  it("accepts every vendored layout name", () => {
    for (const layout of SMARTART_LAYOUT_NAMES) {
      const [op] = build({
        op: "add_smartart",
        slideIndex: 0,
        layout,
        items: ["one"],
        xPx: 0,
        yPx: 0,
        wPx: 10,
        hPx: 10,
      });
      expect(field<string>(op, "layout")).toBe(layout);
    }
  });
});

describe("add_model3d op building", () => {
  it("converts the px rect to EMU and passes ext/bytes through", () => {
    const bytes = bytesOf(4, 4, 4);
    expect(
      build({
        op: "add_model3d",
        slideIndex: 0,
        ext: "glb",
        bytes,
        xPx: 1,
        yPx: 2,
        wPx: 3,
        hPx: 4,
      }),
    ).toStrictEqual([
      {
        op: "addModel3d",
        target: { slide: 0 },
        bytes,
        ext: "glb",
        offset: { x: EMU(1), y: EMU(2), cx: EMU(3), cy: EMU(4) },
      },
    ]);
  });

  it("carries poster and name when given", () => {
    const [op] = build({
      op: "add_model3d",
      slideIndex: 0,
      ext: "gltf",
      bytes: bytesOf(7),
      xPx: 0,
      yPx: 0,
      wPx: 10,
      hPx: 10,
      poster,
      name: "3D Model 1",
    });
    expect(op).toStrictEqual({
      op: "addModel3d",
      target: { slide: 0 },
      bytes: bytesOf(7),
      ext: "gltf",
      offset: { x: 0, y: 0, cx: EMU(10), cy: EMU(10) },
      poster,
      name: "3D Model 1",
    });
  });
});

describe("media refusals", () => {
  const addMedia = (over: Partial<Extract<MediaEdit, { op: "add_media" }>>): MediaEdit => ({
    op: "add_media",
    slideIndex: 0,
    kind: "video",
    ext: "mp4",
    bytes: bytesOf(1),
    xPx: 0,
    yPx: 0,
    wPx: 100,
    hPx: 50,
    ...over,
  });

  const addSmartArt = (over: Partial<Extract<MediaEdit, { op: "add_smartart" }>>): MediaEdit => ({
    op: "add_smartart",
    slideIndex: 0,
    layout: "list",
    items: ["one"],
    xPx: 0,
    yPx: 0,
    wPx: 100,
    hPx: 50,
    ...over,
  });

  const addModel3d = (over: Partial<Extract<MediaEdit, { op: "add_model3d" }>>): MediaEdit => ({
    op: "add_model3d",
    slideIndex: 0,
    ext: "glb",
    bytes: bytesOf(1),
    xPx: 0,
    yPx: 0,
    wPx: 100,
    hPx: 50,
    ...over,
  });

  const cases: Array<[string, MediaEdit, string]> = [
    ["add_media missing slide", addMedia({ slideIndex: 9 }), "media_no_slide"],
    ["add_media negative slide", addMedia({ slideIndex: -1 }), "media_no_slide"],
    ["add_media fractional slide", addMedia({ slideIndex: 0.5 }), "media_no_slide"],
    ["add_media bad kind", addMedia({ kind: "image" as MediaKind }), "media_bad_kind"],
    ["add_media missing kind", addMedia({ kind: undefined as unknown as MediaKind }), "media_bad_kind"],
    ["add_media missing ext", addMedia({ ext: "" }), "media_bad_ext"],
    ["add_media blank ext", addMedia({ ext: "   " }), "media_bad_ext"],
    ["add_media non-string ext", addMedia({ ext: 7 as unknown as string }), "media_bad_ext"],
    ["add_media missing bytes", addMedia({ bytes: undefined as unknown as Uint8Array }), "media_bad_bytes"],
    ["add_media empty bytes", addMedia({ bytes: new Uint8Array(0) }), "media_bad_bytes"],
    ["add_media non-binary bytes", addMedia({ bytes: "AAAA" as unknown as Uint8Array }), "media_bad_bytes"],
    ["add_media negative x", addMedia({ xPx: -1 }), "media_bad_rect"],
    ["add_media zero width", addMedia({ wPx: 0 }), "media_bad_rect"],
    ["add_media zero height", addMedia({ hPx: 0 }), "media_bad_rect"],
    ["add_media NaN y", addMedia({ yPx: Number.NaN }), "media_bad_rect"],
    ["add_media bad poster bytes", addMedia({ poster: { bytes: new Uint8Array(0), ext: "png" } }), "media_bad_poster"],
    ["add_media bad poster ext", addMedia({ poster: { bytes: bytesOf(1), ext: "" } }), "media_bad_poster"],
    ["add_media blank name", addMedia({ name: "" }), "media_bad_name"],
    ["add_smartart missing slide", addSmartArt({ slideIndex: 9 }), "media_no_slide"],
    ["add_smartart bad layout", addSmartArt({ layout: "tree" as SmartArtLayoutName }), "media_bad_smartart"],
    ["add_smartart empty items", addSmartArt({ items: [] }), "media_bad_smartart"],
    ["add_smartart too many items", addSmartArt({ items: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] }), "media_bad_smartart"],
    ["add_smartart non-string item", addSmartArt({ items: ["a", 7 as unknown as string] }), "media_bad_smartart"],
    ["add_smartart non-array items", addSmartArt({ items: "x" as unknown as string[] }), "media_bad_smartart"],
    ["add_smartart bad rect", addSmartArt({ hPx: -3 }), "media_bad_rect"],
    ["add_model3d missing slide", addModel3d({ slideIndex: 9 }), "media_no_slide"],
    ["add_model3d missing ext", addModel3d({ ext: "" }), "media_bad_ext"],
    ["add_model3d missing bytes", addModel3d({ bytes: undefined as unknown as Uint8Array }), "media_bad_bytes"],
    ["add_model3d bad poster", addModel3d({ poster: { bytes: bytesOf(1), ext: " " } }), "media_bad_poster"],
    ["add_model3d bad rect", addModel3d({ wPx: 0 }), "media_bad_rect"],
  ];

  it.each(cases)("refuses %s with %s", (_name, edit, code) => {
    expect(errCode(() => build(edit))).toBe(code);
  });

  it("validates the target before geometry", () => {
    expect(errCode(() => build(addMedia({ slideIndex: 9, xPx: -1, wPx: 0 })))).toBe("media_no_slide");
    expect(errCode(() => build(addSmartArt({ slideIndex: 9, wPx: 0 })))).toBe("media_no_slide");
    expect(errCode(() => build(addModel3d({ slideIndex: 9, wPx: 0 })))).toBe("media_no_slide");
  });

  it("never touches the deck scale when the edit is already refused", () => {
    const noSize: OpenedPptxLike = { deck: { slides: [{ id: "s1", elements: [] }] } };
    expect(errCode(() => build(addMedia({ ext: "" }), noSize, FIT))).toBe("media_bad_ext");
    expect(errCode(() => build(addSmartArt({ layout: "nope" as SmartArtLayoutName }), noSize, FIT))).toBe(
      "media_bad_smartart",
    );
    expect(errCode(() => build(addModel3d({ bytes: new Uint8Array(0) }), noSize, FIT))).toBe("media_bad_bytes");
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build(addMedia({ kind: "gif" as MediaKind }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("media_bad_kind");
  });
});