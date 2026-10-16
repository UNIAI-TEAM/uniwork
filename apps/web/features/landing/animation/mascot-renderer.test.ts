import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Loop = ((time: number) => void) | null;
const state = vi.hoisted(() => ({ loop: null as Loop }));

vi.mock("three", () => {
  class Texture {
    colorSpace = "";
    dispose() {}
  }
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    setPixelRatio() {}
    setSize() {}
    render() {}
    setAnimationLoop(next: Loop) { state.loop = next; }
    forceContextLoss() {}
    dispose() {}
  }
  class TextureLoader {
    load(_url: string, onLoad: (texture: Texture) => void) {
      const texture = new Texture();
      onLoad(texture);
      return texture;
    }
  }
  class Disposable { dispose() {} }
  return {
    WebGLRenderer,
    TextureLoader,
    Scene: class { add() {} },
    OrthographicCamera: class {
      position = { z: 0 };
      left = 0; right = 0; top = 0; bottom = 0;
      updateProjectionMatrix() {}
    },
    ShaderMaterial: Disposable,
    PlaneGeometry: Disposable,
    Mesh: class {},
    SRGBColorSpace: "srgb",
  };
});

import { createMascotRenderer } from "./mascot-renderer";

/** The wave is documented as one 2.4-second gesture (apps/web/DESIGN.md). */
const WAVE_SECONDS = 2.4;

let intersect: (isIntersecting: boolean) => void;

beforeEach(() => {
  state.loop = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      intersect = (isIntersecting) => callback([{ isIntersecting }]);
    }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mountVisibleMascot() {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 400 });
  Object.defineProperty(host, "clientHeight", { value: 400 });
  const mascot = createMascotRenderer(host, () => {});
  mascot.setState({ paused: false });
  intersect(true);
  return { host, mascot };
}

/** Runs the animation loop at a fixed frame interval until it stops; returns the wall time of the frame that ended it. */
function runFrames(host: HTMLElement, frameMs: number, limitMs: number): number {
  const start = 1_000;
  let time = start;
  let lastFrame = start;
  while (state.loop && time - start <= limitMs) {
    lastFrame = time;
    state.loop(time);
    time += frameMs;
  }
  expect(host.dataset.expression).toBe("idle");
  return lastFrame - start;
}

describe("mascot wave timing", () => {
  it.each([
    { name: "60 fps", frameMs: 1000 / 60 },
    { name: "20 fps", frameMs: 50 },
    { name: "5 fps (software WebGL on a loaded CI runner)", frameMs: 200 },
    { name: "2 fps", frameMs: 500 },
  ])("ends one wave $name after it starts, whatever the frame rate", ({ frameMs }) => {
    const { host, mascot } = mountVisibleMascot();
    expect(host.dataset.running).toBe("true");
    expect(host.dataset.expression).toBe("greeting");

    const elapsed = runFrames(host, frameMs, 20_000);

    expect(elapsed / 1000).toBeLessThanOrEqual(WAVE_SECONDS + frameMs / 1000 + 0.001);
    expect(host.dataset.running).toBe("false");
    expect(state.loop).toBeNull();
    mascot.dispose();
  });

  it("does not spend the wave while the horse is offscreen", () => {
    const { host, mascot } = mountVisibleMascot();
    state.loop?.(1_000);
    state.loop?.(2_000);
    intersect(false);
    expect(host.dataset.running).toBe("false");
    intersect(true);
    expect(host.dataset.running).toBe("true");
    // The first frame after resuming only re-anchors the clock.
    state.loop?.(60_000);
    expect(host.dataset.expression).toBe("greeting");
    mascot.dispose();
  });
});
