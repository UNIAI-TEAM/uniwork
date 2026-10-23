import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  manipulate: vi.fn(),
  resize: vi.fn(),
  saveAsync: vi.fn(async (options: { compress: number; format: string }) => ({ uri: `file:///cache/scaled.${options.format}`, width: 2048, height: 1536 })),
  fail: false,
}));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  ImageManipulator: {
    manipulate: (uri: string) => {
      native.manipulate(uri);
      const context = {
        resize: (size: object) => {
          native.resize(size);
          return context;
        },
        renderAsync: async () => {
          if (native.fail) throw new Error("decode failed");
          return { width: 2048, height: 1536, saveAsync: native.saveAsync };
        },
      };
      return context;
    },
  },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    readonly size: number;
    constructor(uri: string) {
      this.size = uri.endsWith(".png") ? 900_000 : 600_000;
    }
  },
}));

import { downscalePhoto } from "./photo-downscale";

const photo = { uri: "file:///picker/IMG_1.jpg", name: "IMG_1.jpg", mimeType: "image/jpeg", size: 4_200_000 };

beforeEach(() => {
  vi.clearAllMocks();
  native.fail = false;
});

describe("downscalePhoto", () => {
  it("scales a large JPEG's longer side to the cap and sends the smaller copy", async () => {
    await expect(downscalePhoto(photo, { width: 4032, height: 3024 })).resolves.toEqual({ ...photo, uri: "file:///cache/scaled.jpeg", size: 600_000 });
    expect(native.manipulate).toHaveBeenCalledWith(photo.uri);
    expect(native.resize).toHaveBeenCalledWith({ width: 2048 });
    expect(native.saveAsync).toHaveBeenCalledWith({ compress: 0.8, format: "jpeg" });
  });

  it("keeps a PNG a PNG", async () => {
    const shot = { ...photo, uri: "file:///picker/shot.png", name: "shot.png", mimeType: "image/png" };
    await expect(downscalePhoto(shot, { width: 1290, height: 2796 })).resolves.toMatchObject({ uri: "file:///cache/scaled.png", size: 900_000 });
    expect(native.resize).toHaveBeenCalledWith({ height: 2048 });
  });

  it("sends a small photo, a GIF or a photo it cannot read as picked", async () => {
    await expect(downscalePhoto(photo, { width: 1600, height: 1200 })).resolves.toBe(photo);
    const gif = { ...photo, mimeType: "image/gif" };
    await expect(downscalePhoto(gif, { width: 4000, height: 3000 })).resolves.toBe(gif);
    expect(native.manipulate).not.toHaveBeenCalled();
    native.fail = true;
    await expect(downscalePhoto(photo, { width: 4032, height: 3024 })).resolves.toBe(photo);
    vi.mocked(native.saveAsync).mockRejectedValueOnce("native");
    native.fail = false;
    await expect(downscalePhoto(photo, { width: 4032, height: 3024 })).resolves.toBe(photo);
  });
});
